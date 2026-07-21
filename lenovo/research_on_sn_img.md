---
output: word_document
---

# sn.img 鉴权机制技术分析

> 关联关键词：解锁研究、sn.img 鉴权、Bootloader_SN 绕过
>
> 在利用 IDA Pro 复现研究结果前，请先利用 UEFITool 提取 abl.elf 或 abl.img 中 Application/LinuxLoader 部分的 PE32 Image Body 部分。
>
> (Partially powered by DeepSeek)

## 背景

联想平板的 Bootloader 解锁流程涉及两个关键步骤：

1. 通过官方渠道（[ZUI 解锁网站](https://www.zui.com/iunlock)）提交 GSN 和 Bootloader_SN，获取解锁授权文件 `sn.img`
2. 通过 `fastboot flash unlock sn.img` 刷入授权文件，再执行 `fastboot oem unlock-go` 完成解锁

历史上曾存在一种"邪修"方法：通过修改 `sn.img` 中的 Bootloader_SN 字段，使一个已授权的 `sn.img` 可用于多台不同设备。

> [!warning]
> 经过对新版 ABL (Android Bootloader) 的逆向分析，此绕过方法已被完整的签名链验证机制封堵，**已确认不可行**。

## 分析对象

从联想 TB710FU (小新 Pad Pro GT) 最新版系统固件中提取的 ABL 镜像：

| 项目 | 说明 |
|------|------|
| **固件版本** | 最新正式版系统 |
| **架构** | AArch64 (ARM64) PE32+ |
| **函数数量** | 1998 个 |
| **代码量** | .text: 0x83000 (约 536 KB) |

## 鉴权全流程

### 第一步：刷入 sn.img

```
fastboot flash unlock sn.img
```

`flash:` 命令 handler (`sub_5BE70` @0x5bee4) 检测到分区名为 `"unlock"` 后进入专用处理路径：

- **尺寸校验**: sn.img 必须恰好为 **356 字节** (0x164)
  - 不匹配则报错 `"FlashNumDataBytes is %lu, not UNLOCK_IMG_SIZE"`
- **数据存储**: 将 356 字节复制到全局缓冲区 `unk_A3B41` (0xa3b41)
- **确认消息**: 打印 `"get unlock.img success"`

### 第二步：执行解锁

```
fastboot oem unlock-go
```

命令 `"oem unlock"` 的 handler (`sub_5D6B8` 内部 @0x5f04c) 调用核心验证函数 **`sub_62760`**。

### 核心验证函数 `sub_62760` (@0x62760)

#### 参数传递

```
X0 = unk_A3B41          ← sn.img 数据指针 (356 字节)
X1 = unk_A3A9C          ← 64 字节 token 缓冲区
```

#### 验证步骤

```
sub_62760(a1=sn.img, a2=token_buf)

  1. 初始化 SHA256 上下文
     硬编码密钥: "1a2blenovo3c4d5e" (16 字节)
     目标结构: unk_A4070

  2. 复制 64 字节 token

  3. 计算 SHA256 哈希
     失败 → 返回 -7 → "oem unlock fail, CALC"

  4. 通过 EFI 协议调用 QSEE (Qualcomm TrustZone)
     协议表: off_8AF00 条目 40
     读取数据:
      · unk_8ADF0: 256 字节 (证书公钥)
      · unk_8ADED: 3 字节 (标志/类型)

  5. 执行 RSA-2048/SHA256 签名验证
     输入:
      · SHA256 哈希 (32 字节)
      · sn.img 偏移 0x64 起的 256 字节签名
      · 证书公钥 (256 字节)
      · 64 字节 token

  6. 验证结果 → 8 路 switch 分发
       ├── 0     (case 7): ✅ 成功
       │    检查 dword_A354C (解锁能力标志)
       │    ├── 非零 → 执行解锁
       │    └── 零   → "Device dose not allow unlock"
       ├── -5    (case 2): ❌ "oem unlock fail, VERIFY"
       ├── -4    (case 3): ❌ "oem unlock fail, PROTOCAL"
       ├── -7    (case 0): ❌ "oem unlock fail, CALC"
       └── 其他   (default): ❌ "oem unlock fail, OTHERS"
```

## sn.img 文件格式

```
偏移 0x00 - 0x63 (100 字节):  元数据头部
  包含:
  · Bootloader_SN (64 字符 ASCII hex)
  · GSN (8 位, 如 "HA2899VJ") 的派生摘要
  · 其他设备凭据

偏移 0x64 - 0x163 (256 字节):  RSA-2048 数字签名
  · 由 Lenovo 私钥签发
  · 算法: RSA-PSS/SHA256 (或 RSA-PKCS1v15/SHA256)
```

## 证书链

ABL 的证书存储区包含 **4 个 Lenovo X.509 证书**：

| 证书层级 | 主题关键信息 |
|---------|-------------|
| **Root CA** | `LENOVO Root CA1`, Beijing, SecTools1 |
| **Attestation CA** | `LENOVO Attestation CA1`, California, San Diego |
| **Keys** | `LENOVO Keys1`, Beijing, SecTools1 |
| **Root CA (副本)** | `LENOVO Root CA1` (不同有效期) |

有效期 (UTC)：2025-04-09 ~ 2045-04-04

## 摘要算法推测

```
Digest = SHA256(
    "1a2blenovo3c4d5e"  ||    // 固定密钥 (16 字节)
    Token_64bytes        ||    // 申请时下发的 64 字节 token
    Bootloader_SN_ASCII  ||    // 64 字符 Bootloader SN (hex 编码)
    GSN_8bytes           ||    // 8 位设备串号
    Other_Credentials         // 其他设备凭据
)
```

## "绕过鉴权"可行性分析

### 旧方法的失效原因

过去的绕过方式：修改 `sn.img` 中的 Bootloader_SN 字段以复用已授权的解锁文件，其成立的前提是 ABL **仅做字符串级别的 Bootloader_SN 比对**，而不验证签名的完整性。

新版 ABL 的鉴权机制**不再给这种篡改留余地**：

| 绕过方式 | 阻断层 | 原因 |
|---------|--------|------|
| 修改 sn.img 中的 Bootloader_SN | ❌ **签名校验** | sn.img 含有 RSA 签名，任何字节篡改都会导致签名验证失败 |
| 直接替换 sn.img 中的签名 | ❌ **私钥缺失** | 签名需要 Lenovo 私钥，不可获取 |
| 修改 ABL 绕过验证 | ❌ **Boot 校验** | ABL 所在的 FV (Firmware Volume) 被 AES 加密 |
| 利用 TEE 侧漏洞绕过 QSEE 验证 | ❌ **极高门槛** | 需要 TrustZone 级别的高危漏洞 |

### 根本原因

新版鉴权体系是**端到端签名链验证**：

```
Lenovo 私钥 (服务器端, 不可获取)
  │
  ├──→ 签发 sn.img (RSA-2048 签名)
  │      ├── Bootloader_SN (绑定具体设备)
  │      ├── GSN (绑定具体设备)
  │      └── Token (一次性, 绑定申请会话)
  │
  └──→ 验证由 QSEE (TrustZone) 完成
         ├── 公钥固化在 BootROM/证书分区
         ├── 无法从用户空间篡改
         └── 验证过程在 TEE 隔离环境中执行
```

四个关键防护层：

1. **签名不可伪造**: RSA-2048 签名需要 Lenovo 私钥
2. **设备绑定**: `sn.img` 嵌入 Bootloader_SN + GSN，无法在不同设备间复用
3. **一次一密**: 每次申请下发不同的 token，防止重放
4. **TEE 隔离**: 验证在 TrustZone 内执行，ABL 本身也无法绕过

## 结论

- **`sn.img` 的鉴权基于完整的 RSA-2048/SHA256 签名链，所有核心密码学操作在 QSEE (TrustZone) 内完成**
- **任何对 `sn.img` 内容的修改都会被签名校验发现**
- **私钥仅 Lenovo 服务器端持有，不可获取**
- **修改 ABL 绕过验证的方法因 FV 加密而不可行**
- **结论：在当前版本下，"邪修"绕过解锁鉴权的方法已完全不可行**

唯一的合法途径是通过 [ZUI 解锁网站](https://www.zui.com/iunlock) 提交申请获取对应自己设备的 `sn.img`。

## 附：abl 关键地址参考

| 组件 | 地址 | 说明 |
|------|------|------|
| 命令表 | `0x8A738` | 30 条 fastboot 命令 |
| `flash:` handler | `0x5BEE4` | 处理 flash 命令 |
| `"oem unlock"` handler | `0x5F04C` | unlock 入口 |
| **核心验证函数** | **`0x62760`** | token + sn.img 验证 |
| 硬编码密钥 | `0x7134A` | `"1a2blenovo3c4d5e"` |
| sn.img 存储区 | `0xA3B41` | 356 字节 |
| Token 缓冲区 | `0xA3A9C` | 64 字节 |
| 解锁能力标志 | `0xA354C` | 设备是否允许解锁 |
| 证书区 | PHDR[2] | 4 个 X.509 证书 |
| EFI 协议表 | `0x8AF00` | 条目 40 → QSEE |

## 附：关于修改 Bootloader SN

我们知道 GSN 存储在 `persist` 分区（`devinfo` 分区另有一份拷贝），可以轻易修改，PSN 也是一样。

不难顺着这个思路想到，只要 Bootloader SN 也可以被修改，就可以伪造一台身份和申请解锁的机器完全一致的设备，复用已有的 sn.img ，解锁后还原相关唯一识别号即可。

But:

sub_5A2BC（Fastboot 初始化）中按顺序获取了以下几组数据，一目了然，不言而喻：

数据获取顺序（地址 0x5A8E8 ~ 0x5AA10）

| 步骤 │ 函数 │ 输出缓冲区 │ 注册变量名 │ 数据来源 |
| - | - | - | - | - |
| 1    │ sub_D160  │ —              │ —                     │ 探测存储类型 (UFS/eMMC等)       |
| 2    │ sub_E070  │ —              │ —                     │ 初始化                         |
| 3    │ sub_F544  │ 0xA361C (64B)  │ serialno              │ ChipInfo/MemCardInfo → UFS CID |
| 4    │ sub_F240  │ 0xA365C (64B)  │ pserialno             │ misc 分区 (4000B→取前64B)       |
| 5    │ sub_32B14 │ 0xA3ADD (100B) │ hwboardid 等          │ —                              |
| 6    │ sub_5B9C8 │ 0xA3A9C        │ Bootloader_SN_Part1/2 │ SHA-256(UFS序列号 + UEFI变量)   |