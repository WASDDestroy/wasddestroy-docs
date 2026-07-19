---
output: word_document
---

# sn.img 鉴权机制技术分析

> 关联关键词：解锁研究、sn.img 鉴权、Bootloader_SN 绕过、前端登录分析
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

## 关于"前端攻击绕过登录"的说法

> 关联关键词：免登录提交、前端绕过、passport.lenovo.com

部分用户认为通过攻击解锁申请页面的前端 JavaScript，可以绕过联想账号登录直接提交解锁申请，从而绕开每日限额。为此，我们对解锁申请页面的前端 JS（来自 `www.zui.com/iunlock`）进行了分析。

### 登录机制

解锁页面使用 **Lenovo Passport SSO**（单点登录）系统：

```
1. 用户访问 www.zui.com/iunlock
2. 页面检测 SCK 和 USERNAME cookie
   ├── 存在 → 显示已登录状态 (body.is-login)
   └── 不存在 → 显示登录按钮
3. 点击登录 → 跳转至 passport.lenovo.com
   URL: https://passport.lenovo.com/cnwebauthnv3/gateway
        ?lenovoid.action=uilogin
        &lenovoid.realm=www.zui.com
        &lenovoid.cb=https://www.zui.com/user/thirdCallBack
4. 登录成功后，passport.lenovo.com 回设 SCK cookie
5. 页面检测到 SCK cookie 后确认登录状态
```

核心代码（`myJavaScript.js` 第 304-320 行）：

```javascript
// 检测登录状态
e = getCookie("SCK"),          // Session Cookie Key，由 passport.lenovo.com 签发
t = getCookie("USERNAME"),
e && t ?
    ($("body").addClass("is-login"),
    $(".username").text(decodeURIComponent(t))) :
    ($("body").removeClass("is-login"),
    $(".username").text(""))

// 登录按钮 → 跳转至联想通行证
$(".j-login-btn").click(function() {
    window.location.replace(
        "https://passport.lenovo.com/cnwebauthnv3/gateway?"
        + "lenovoid.action=uilogin"
        + "&lenovoid.realm=" + o
        + "&lenovoid.cb=" + i
        + "&lenovoid.ctx="
    )
})
```

`SCK` 是由 `passport.lenovo.com`（联想统一身份认证）在用户成功登录后设置的会话令牌，**解锁页面本身无法生成或伪造这个 token**。

### UID 获取流程

```javascript
// 第 60-72 行
(userId = getCookie("uid"))
    ? getInfoByAjax()               // cookie 中有 uid → 直接获取验证码
    : $.ajax({                       // 否则向服务端请求
        type: "get",
        url: getUserIdFromUrl,       // GET /unlock
        success: function(e) {
            0 == e.status &&
                (userId = e.data.uid,
                getInfoByAjax(),
                document.cookie = "uid=" + e.data.uid)
        }
    })
```

- 服务端根据当前会话（需要已登录）生成 `uid`
- 未登录状态下，`GET /unlock` 的响应中不会返回有效的 `uid`

### 验证码获取

```javascript
// 第 31-57 行
function getInfoByAjax() {
    $.ajax({
        type: "get",
        url: getUserIdFromUrl,       // GET /unlock/getcode?uid={userId}
        data: { uid: userId },
        success: function(e) {
            0 == e.status && (
                t = e.data.code,     // Lenovo 手机验证码
                o = e.data.zcode,    // ZUK 手机验证码
                i = e.data.tcode,    // Lenovo 平板验证码
                a = e.data.ecode,    // Legion Y700 Gen4 验证码
                s = e.data.y5code,   // Legion Y700 Gen5 验证码
                // 根据产品类型选择对应验证码
            )
        }
    })
}
```

不同的产品类型使用不同的验证码，所有验证码由服务端生成并返回。

### 解锁申请提交

```javascript
// 第 107-287 行，以拯救者 Y700 为例：
$.ajax({
    type: "post",
    url: submitApplicationToUrl,     // POST /unlock/add
    data: {
        token: getCookie("SCK"),      // ← 关键：联想想通行证会话 token
        uid: userId,                  // 用户 ID
        serialnum: serialNumberInput, // GSN (8 位)
        mail: eMailInput,             // 邮箱
        code: verificationCodeInput,  // 验证码
        source: productType,          // 产品类型
        enhancednum: bootloaderSnInput// Bootloader_SN
    },
    success: function(e) {
        switch (parseInt(e.status)) {
            case 0:  // 提交成功，等待邮件
            case 6:  // "LenovoID账号异常！"
            ...
        }
    }
})
```

### 为什么前端攻击无法绕过登录

| 设想的方法 | 实际障碍 |
|-----------|---------|
| 修改 JS 跳过登录检测 | `SCK` cookie 由 `passport.lenovo.com` SSO 签发，前端无法伪造 |
| 直接 POST 到 `/unlock/add` | 服务端验证 `token`（SCK）的有效性，无效则拒绝 |
| 伪造 `uid` cookie | `uid` 由服务端根据当前登录会话生成，没有登录就没有有效 `uid` |
| 跳过验证码校验 | 验证码由服务端生成，前端只做展示；提交时服务端再次校验 |
| 利用 debug 参数 | `isDebug` 参数仅将 API 地址切换为 mock JSON，不影响服务端逻辑 |

**关键点**：

1. `SCK`（Session Cookie Key）是 **Lenovo 统一通行证** 签发的会话令牌，只有通过 `passport.lenovo.com` 成功登录才能获得
2. `POST /unlock/add` 提交的数据中同时包含 `token`（SCK）和 `uid`，服务端对两者均做校验
3. 即使完全绕过前端直接构造 HTTP 请求，也无法提供有效的 `SCK` → 服务端返回错误码 6：`"LenovoID账号异常！"`
4. 解锁申请还有服务端限频（错误码 3）、账号解锁次数限制（错误码 4）、每日总量限额（错误码 8）等多层防护

### API 端点一览

| 端点 | 方法 | 作用 |
|------|------|------|
| `GET /unlock` | 获取 `uid`（基于当前登录会话） |
| `GET /unlock/getcode` | 获取图形验证码（需 `uid`） |
| `POST /unlock/add` | 提交解锁申请（需 `token` + `uid`） |

### 小结

- **登录是硬性前提**：没有有效的联想账号登录，就无法获得 `SCK` 会话令牌，也就无法通过服务端验证
- **前端不可信原则**：即使修改前端 JS 或直接构造 HTTP 请求，缺少 `SCK` 的服务端校验必然失败
- **账户关联追溯**：解锁申请与联想账号绑定，官方可追溯到申请者

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
