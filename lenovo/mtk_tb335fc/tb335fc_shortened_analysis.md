# 联想平板官方救砖包说明（MTK 版）

> [!important]
> 尚有不确定之处，参考 [完整分析](./tb335fc_analysis.md) 了解当前不明确处。
>
> 尽管如此，这里依旧可以大胆论断：草台班子。

官方流出的电脑端线刷救砖包里往往塞满了上百个大大小小的文件，里面不仅有系统镜像，还混杂着看似未签名的组件、调试文件以及让人摸不着头脑的数据库。拆解这个官方救砖包背后的打包逻辑和芯片级安全机制，可以把以下十五个核心问题彻底讲透。

---

## 一、包里的 `image/mtk_unsigned_images` 目录是怎么来的？真的是未签名的吗？

未签名，这个目录被留下只是因为构建系统设置时的疏漏。

在 MTK 标准编译流程中，`sign-image` / `sign_flow.py` 在给底层固件加盖平台证书之前，会先将未签名原始文件保留在 `mtk_unsigned_images/` 作为构建中间备份目录，再把签名后的正式文件输出到外层 `image/` 目录。

逐文件比对内外两套同名文件可以确认：除了 `efuse.img` 完成签名（采用 MTK **EFUSE Self-Blow** 专用二进制结构，内部直接携带了 `cert1` 根公钥块 `mtk_key` 的 SHA-256 哈希 `sbc_key_hash`，不走 MKIMG 证书附加流程），其余镜像均未签名。其中 **`scp.img` 与 `vcp.img`** 还是未加密明文。

刷机脚本和 XML 均未引用 `mtk_unsigned_images/` 下的任何文件，实际刷机时完全不会刷入。

---

## 二、为什么 `image/download_agent/flash.xml` 和 `image/flash.xml` 一模一样？

为了迁就 `SPFlashToolV6.exe` 按 `flash.xml` 所在目录解析相对路径的规则，发布时把 `image/download_agent/` 下的 4 个文件复制到父目录，同时忘了删掉原 `download_agent/` 子目录。

按照 MTK Android 编译合包的标准布局，DA 相关文件（`DA_BR.bin`、`da.auth`、`flash.xsd`、`flash.xml`）默认输出在 `image/download_agent/` 子目录中。早期版本的标准写法是在 `flash.xml` 里把 `<scatter>` 写成 `../MT6835_Android_scatter.xml`，这样工具直接读取子目录的 `flash.xml` 就能找到上一级的 Scatter 文件。

但在本包里，`flash.xml` 的标签中全都是同级裸文件名，SPFlash 会因找不到 `image/download_agent/MT6835_Android_scatter.xml` 而报错。

因此工程人员在 `2026-09-18` 定稿 `flash.xml` 后，将 `image/download_agent/` 下的全部 4 个文件原样复制到 `image/` 根目录与 `MT6835_Android_scatter.xml` 同级放置，同时保留了原 `image/download_agent/` 目录并同步留存最新版 `flash.xml`；而 `运行我，刷机.cmd` 最终只通过 `-f` 参数调用外层的 `image/flash.xml`。

---

## 三、`image/flash.xsd` 是干什么用的？里面记录了哪些信息？

它是 `flash.xml` 的 W3C XML Schema 结构校验文件，用来在刷机前检查 `flash.xml` 有没有写错结构或漏填字段。

`SPFlashToolV6.exe` 在加载刷机入口文件时，会通过 `Qt5XmlPatterns.dll` 加载与被读取 XML 同目录的 `flash.xsd` 进行结构校验。在 `tool/log/*/QT_FLASH_TOOL_V6.log` 留存的历史日志中就能看到：如果缺失 `flash.xsd`，或者误把 `MT6835_Android_scatter.xml` 直接当作入口文件加载，Schema 校验就会立刻失败并弹窗报错（提示 `... is invalid. Please select the ./download_agent/flash.xml in the load.`）。

`flash.xsd` 定义根元素 `<flash-mode>`（类型 `flashInfo`），要求严格按固定顺序包含以下 7 个必选 `xs:string` 元素：

| 字段 | 实际填写内容 | 用途 |
| - | - | - |
| `project` | `sycamore_prc_consumer_wifi` | 工程标识元数据，`SPFlashToolV6.exe` 解析器未读取 |
| `dagent` | `DA_BR.bin` | 核心功能字段，指定 Download Agent 路径 |
| `scatter` | `MT6835_Android_scatter.xml` | 核心功能字段，指定分区散列表路径 |
| `build_version` | `alps-mp-t0.mp1-V13.17.3` | MTK ALPS BSP 基线版本号，仅元数据 |
| `build_time` | `2026-09-08 03:47:42` | 镜像打包时间，仅元数据 |
| `version` | `1.0` | XML 描述格式版本，仅元数据 |
| `contact` | `Fengping.Yu` | 报错时用于提示联系人信息；因打包前未脱敏，工程师姓名留在了公开包里 |

---

## 四、`APDB_MT6835___W2440` 与 `APDB_MT6835___W2440_ENUM` 有什么用？

它们是供 MTK META Mode 产线/售后校准与写号工具使用的 NVRAM 数据结构说明，线刷救砖完全用不到它们。

这两个文件名带平台代号与构建周次（`W2440`）的文件，分别是 **MTK `CATD` 二进制 C 类型/NVRAM 数据库**和**纯文本枚举表**：

- `APDB_MT6835___W2440`：记录了 80 个唯一 `AP_CFG_*_LID`（NVRAM 逻辑项定义）及 187 组 C 结构体布局与字段对齐信息，涵盖音频参数与增益校准、相机 3A/对焦/阴影/Pline 调优、Wi-Fi/蓝牙/GPS 校准与地址、传感器/电量计/SmartPA 校准，以及产线设备与出厂身份信息（`PRODUCT_INFO` / `FACTORY`）等。
- `APDB_MT6835___W2440_ENUM`：定宽纯文本枚举表，将 `AP_CFG_*_LID` 编号（`0..78`）以及 `AUDIO_GAIN_*`、`VOL_*`、`MOD_*`、`*_SAP`、`MSG_ID_*`、`TRACE_*` 等枚举符号映射为具体整数值。

PC 端的 **MTK META Mode 产线与售后工具**（如 SP META、ModemMETA、SN Writer、Audio Tuning Tool、Catcher）在读写设备 `nvram` / `nvdata` / `proinfo` 中的射频、音频、传感器校准及 SN/MAC 地址时，必须依靠它们按准确字节偏移序列化和反序列化。而 `SPFlashToolV6.exe`、`flash.dll` 与 Scatter 文件对它们均为零引用，出现在救砖包里同样是因为打包时从编译输出目录直接拷贝未剔除。

---

## 五、除了常规安卓分区外，包里其他一大堆镜像各自负责什么？

排除 13 项常见 AOSP 标准组件（`boot`、`dtbo`、`init_boot`、`super`、`system_dlkm`、`system_ext`、`system_other`、`userdata`、`vbmeta`、`vbmeta_system`、`vbmeta_vendor`、`vendor`、`vendor_boot`）后，`image/` 内其余非 AOSP 镜像、二进制及衍生文件可分为四大类：

1. 引导加载程序、刷机代理与认证文件（3 个）

| 分区名 | 镜像名 | 刷入的分区 | 用途 |
| --- | --- | --- | --- |
| `preloader` | `preloader_sycamore_prc_consumer_wifi.bin` | `preloader`（`EMMC_BOOT1`/`UFS_LU0`）、`preloader_backup`（`EMMC_BOOT2`/`UFS_LU1`） | MTK BL2 |
| `—`（非分区镜像） | `DA_BR.bin` | 不刷入 | Download Agent |
| `—`（非分区镜像） | `da.auth` | 不刷入 | MTK 签名认证文件 |

1. MTK SoC 底层固件、TEE/Hypervisor、`logo` 与 `efuse`（13 个）

   除 `efuse.img` 外，以下 12 个均为带 MTK 签名证书（`cert1`/`cert2`）的 MKIMG 容器，且在 Scatter 中仅刷写 `*_a` 槽位（`*_b` 槽位不下载）：

| 分区名 | 镜像名 | 刷入的分区 | 用途 |
| --- | --- | --- | --- |
| `lk` | `lk.img` | `lk_a`（16 MiB） | 含 5 个子镜像：`lk`（Little Kernel AP 主引导 + Fastboot + AVB 2.0）、`bl2_ext`（BL2 扩展加载器）、`aee`（MTK 异常崩溃转储模块）、`lk_main_dtb`（`MT6835` 设备树）与 `lk_dtbo`（外设覆盖层） |
| `tee` | `tee.img` | `tee_a`（5 MiB） | 含 `atf`（ARM Trusted Firmware EL3，安全监控与 DEVMPU 隔离）与 `tee`（豆荚 Beanpod/ISEE 安全操作系统，提供 Keymaster/DRM/RPMB 安全执行环境） |
| `gz` | `gz.img` | `gz_a`（32 MiB） | 含 `gz`（MTK GenieZone EL2 Hypervisor）与 `unmap2`（EL2 Stage-2 内存解映射器，隔离 `atf-reserved`/`tee-reserved` 安全内存） |
| `scp` | `scp.img` | `scp_a`（6 MiB） | 系统协处理器（RISC-V RV55）RTOS 固件，运行低功耗 Sensor Hub 与唤醒任务（外层正式版已加密） |
| `vcp` | `vcp.img` | `vcp_a`（6 MiB） | 视频协处理器（RISC-V RV33）固件，协助卸载视频编解码与显示控制（外层正式版已加密） |
| `sspm` | `sspm.img` | `sspm_a`（1 MiB） | 安全系统功耗管理器固件，负责温控、DVFS 与系统功耗监测（SWPM） |
| `mcupm` | `mcupm.img` | `mcupm_a`（1 MiB） | MCU 功耗管理器（RV33）固件，控制 CPU 集群调频与核心休眠 |
| `dpm` | `dpm.img` | `dpm_a`（4 MiB） | DRAM 功耗管理器固件（含 `dpmpm`/`dpmdm`/`dpmpt`），管控内存低功耗状态与调频 |
| `spmfw` | `spmfw.img` | `spmfw_a`（1 MiB） | 系统功耗管理微码，负责深度待机（Suspend-to-RAM）状态机 |
| `pi_img` | `pi_img.img` | `pi_img_a`（1 MiB） | 早期平台初始化（Platform Initialization）扩展模块，由 `bl2_ext` / `lk` 加载 |
| `connsys_bt` | `connsys_bt.img` | `connsys_bt_a`（8 MiB） | MTK Connsys 无线连接子系统蓝牙核固件 |
| `logo` | `logo.img` | `logo_a`（16 MiB） | 含 121 帧 `zlib` 压缩界面图，供 `lk` / `bl2_ext` 显示开机 Logo、关机充电动画、电池故障警示、Fastboot/META 模式与模式选择菜单、区域不兼容白屏提示 |
| `efuse` | `efuse.img` | `efuse`（512 KiB） | 非 MKIMG；MTK EFUSE Self-Blow 配置数据，携带 SBC 公钥哈希与熔丝校验标志 |

1. 联想 OEM 专属镜像（2 个）

| 分区名 | 镜像名 | 刷入的分区 | 用途 |
| --- | --- | --- | --- |
| `lenovocust` | `lenovocust.img` | `lenovocust`（300 MiB） | 原始 EXT4 镜像，用于清空并格式化 `lenovocust` |
| `lenovoraw` | `lenovoraw.img` | `lenovoraw`（16 MiB） | 空白镜像，用于重置 `lenovoraw`（`lk` 从中读取 `csdk_cofig.flash_dis`、`custLogo_enable` 等标记） |

1. AOSP 衍生与辅助残留文件（均未入 Scatter）

| 分区名 | 镜像名 | 刷入的分区 | 用途 |
| --- | --- | --- | --- |
| `odm_dlkm` | `odm_dlkm.img` | 不单独刷入（已打入 `super.img`） | 对应 `super.img` 内 `odm_dlkm_a` |
| `vendor_dlkm` | `vendor_dlkm.img` | 不单独刷入（已打入 `super.img`） | 对应 `super.img` 内 `vendor_dlkm_a` |
| `super`（空模板） | `super_empty.img` | 不刷入 | 供 `fastboot wipe-super` 使用 |
| `userdata`（条带副本） | `userdata_stripe_0.img`、`userdata_stripe_1.img` | 不刷入（SPFT 只刷 `userdata.img`） | 由 `userdata.img` 按 1 MiB 交错拆分而成的双通道条带版稀疏镜像 |
| `boot`（调试版） | `boot-debug.img` | 不刷入 | 详见第八节 |
| `vendor_boot`（调试版） | `vendor_boot-debug.img` | 不刷入（未入 Scatter） | 详见第八节 |
| `—`（块映射） | `system_ext.map`、`vendor.map`、`vendor_dlkm.map`、`system_dlkm.map`、`odm_dlkm.map` | 不刷入 | OTA `blockimgdiff` 块映射文件 |
| `—`（编译清单） | `installed-files-ramdisk.txt`、`installed-files-vendor.txt` | 不刷入 | 文件尺寸清单 |
| `—`（旧版 Scatter） | `MT6835_Android_scatter.txt` | 不刷入 | 旧版纯文本格式 Scatter |

---

## 六、为什么 `super.img` 里的部分逻辑分区镜像会单独散落在包里？

散落出来的 6 个逻辑分区镜像（`vendor.img`、`system_ext.img`、`vendor_dlkm.img`、`system_dlkm.img`、`odm_dlkm.img`、`system_other.img`）其实已全部打入 `super.img`，存在独立的动态分区镜像属构建系统问题。

现代安卓系统为了将通用系统框架与芯片厂商硬件适配解耦，采用了 **Split-Build（双树分离编译）** 流水线：

- **MSSI 系统编译树**（`mssi_t_64_cn_armv82_wifi`，Android 16 SDK 36）负责产出 `system`、`product`、`system_ext`、`system_other`（`system_b`）及 `system_dlkm` 文件内容，先在较早时间点编译完成。
- **Vendor/BSP 厂商树**（`sycamore_prc_consumer_wifi`，Vendor SDK 33）负责产出 `vendor`、`vendor_dlkm`、`odm_dlkm`，在合并阶段对 `system_dlkm.img` 用厂商密钥重签 AVB 脚标，最终由 `lpmake` 将 8 个有效逻辑分区（`odm_dlkm_a`、`product_a`、`system_a`、`system_b`、`system_dlkm_a`、`system_ext_a`、`vendor_a`、`vendor_dlkm_a`，另有 6 个空占位 `*_b` 分区）严丝合缝地打包进 `super.img`。

经提取逐字节比对，散落在包里的 6 个独立逻辑镜像与 `super.img` 内部对应分区的 SHA-256 **100% 一致**。联想制作救砖包时，只剔除了体积最大的 `system.img`（~6.27 GiB）和 `product.img`（~793 MiB），却把其余约 1.3 GiB 的 6 个散落逻辑镜像、`*.map`（OTA `blockimgdiff` 块映射）以及 `super_empty.img` 留在了包里；而 `MT6835_Android_scatter.xml` 实际上只刷写 `super.img`，这些散落文件均不在 Scatter 中。

---

## 七、`lk.img` 是否负责 AVB 验签？它的公钥指纹性质如何？

`lk.img` 完整承担着 AVB 2.0 的核心验签职责，其内部硬编码嵌入了与 `vbmeta.img` 严格匹配的官方 RSA-4096 公钥。约等于高通平台的 `abl` 。

在启动流程中，芯片先由 Preloader 和 `bl2_ext` 加载 `lk.img`；当 `lk` 准备引导安卓内核之前，会启动内置的 `libavb`（`load_vfy_boot` -> `avb_slot_verify`），沿着“`vbmeta` -> `vbmeta_system` / `vbmeta_vendor` / `boot` 等 Chain Partition -> 非链式分区”的信任链逐级核查完整性与签名，并注入 `androidboot.verifiedbootstate`（Green / Yellow / Orange / Red State）。

`lk` 内嵌了一把 512 B 模数的 **OEM RSA-4096 AVB 公钥**（`lk_avb_key`, 提取得到散列值 `8fcb864f11f53ed11284615fb67685522085d3a2`），用来直接比对 `vbmeta` 携带的公钥。此外它内部另存有一把 256 B 的 RSA-2048 密钥 `g_sec_oemkey`，专供 MTK `cert1`/`cert2` 启动链使用，并非 AVB 公钥。

进一步对比目前公开可寻的最早版本 `1.1.10.299`（Android 15，2025-05）与 `1.5.10.321`（Android 16，2026-09），还能还原出一次完整的密钥轮换：

- 1.1.10.299：
  - 主 `vbmeta` 与 `lk_avb_key` 使用 AOSP 公开测试密钥 `testkey_rsa2048.pem`
  - `recovery`、`boot`、`vbmeta_system`、`vbmeta_vendor` 各自使用不同的 RSA-2048 密钥；
- 1.5.10.321：
  - AVB 启动链全部签名密钥轮换并统一为同一把 OEM RSA-4096 正式密钥
  - MTK 平台 `cert1`/`cert2` 根密钥（`g_sec_oemkey` 与 `efuse.img`）保持不变。

因此，在锁定 Bootloader 的设备上，严禁混刷两个版本的单个 `lk`、`vbmeta*` 或 `boot` 分区，必须整套配套刷入同一密钥代际的固件。

---

## 八、`boot-debug.img` 与 `vendor_boot-debug.img` 有什么用？放宽了哪些限制？锁 BL 能用吗？

这两个遗留的调试引导镜像，是 AOSP 测试与 MTK 研发阶段用来在不更换正式版 `system` 分区的前提下获取内核日志和 `adb root` 调试权限的工程产物，它们在 Scatter 中默认不会被刷入。

### 1. 各自放宽了哪些限制、能用于什么调试？

- `boot-debug.img`：相比 `boot.img` 的 Google 通用 GKI 内核，`boot-debug.img` 换成了 MTK/本地 ACK 调试内核（`IKCFG_ST` 配置共有 980 项差异）：
  - 关闭 `CONFIG_TRIM_UNUSED_KSYMS` 与 `CONFIG_MODULE_SIG_ALL`/`CONFIG_MODULE_SIG_FORCE`，导出完整内核符号表并放宽模块签名限制，便于加载树外或调试用 `.ko` 驱动模块；
  - 开启下列调试措施：
    - UART 串口控制台
    - `MTK_AEE_IPANIC` 崩溃转储
    - `BLOCK_IO_TRACER`/`MMSTAT_TRACER`
    - `DMABUF_HEAPS_DEBUG`/`MMC_DEBUG`/`APUSYS_DEBUG`
    - `THERMAL_TRACE`
    - `MICROTRUST_TZ_LOG`（TEE 日志）
    - `NL80211_TESTMODE`
- `vendor_boot-debug.img`：同正式版 `vendor_boot.img` 相比仅新增了 3 个文件：
  - `force_debuggable`（0 B 空哨兵文件）；
  - `adb_debug.prop`（以最高优先级覆写 `ro.adb.secure=0`、`ro.debuggable=1`、`ro.force.debuggable=1`，免去 ADB RSA 宿主授权弹窗并启用调试状态）；
  - `userdebug_plat_sepolicy.cil`（`userdebug` 平台 SELinux 策略，包含 273 条 `adbd`/`su` 放宽规则），让 `user` 正式版系统无需刷写 `system` 即可直接执行 `adb root`。

### 2. 锁定 Bootloader 的设备上能否加载？

不能，没有使用有效 AVB 密钥进行签名。

---

## 九、为什么刷入该包后，原先解锁 Bootloader 的设备会自动回锁？

`运行我，刷机.cmd` 使用了 `-c firmware-upgrade` 模式，而保存解锁状态的 `seccfg` 分区在 `MT6835_Android_scatter.xml` 中被标记为 `INVISIBLE`，导致 `DA_BR.bin` 在刷机过程中直接擦除了 `seccfg`。

1. `运行我，刷机.cmd` 调用 `SPFlashToolV6.exe` 并传入 `-f`（指向 `image/flash.xml`）与 `-c firmware-upgrade`，对应向 `DA_BR.bin` 下发 **`CMD:FLASH-UPDATE`** 升级协议。
2. 在 Scatter 分区保护策略里，只有标记为 `PROTECTED` 或 `BINREGION` 的分区（本包中仅 `frp`、`nvcfg`、`persist`、`protect1`、`protect2`、`proinfo`、`nvram`）才会在固件升级时被预先备份并回写。
   - 而**负责保存 Bootloader 锁状态的 `seccfg` 分区**（以及 `lenovolock` 等）在 `MT6835_Android_scatter.xml` 中被标记为 `INVISIBLE`、`is_download="false"`。
3. 在 `CMD:FLASH-UPDATE` 的 `FU_S0`~`FU_S3` 阶段中，`DA_BR.bin` 只备份并回写 `PROTECTED`/`BINREGION` 分区，并在 `FU_S2` 阶段重建 GPT、**擦除所有非受保护分区**——`seccfg` 就此被彻底擦空。
4. 刷机后首次开机，`lk.img` 的 `sec_get_seccfg()` 读取 `seccfg` 分区里经过硬件 HACC 加密与 SHA-256 校验的 60 B `SECCFG_V4` 结构。因分区已被擦空导致校验失败，`lk` 按默认安全策略重新写入 `lock_state = 1`（`LKS_DEFAULT`，已锁定）的新 `SECCFG_V4` 数据，完成自动回锁。

同时可以排除其他干扰项：`frp` 与 `proinfo` 因 `PROTECTED` 被完整保留；`lenovoraw.img` 内容全零使 `csdk_cofig.flash_dis == 0`，不会触发 `lenovolock` 写入；RPMB 仅用于 `[Check_Region]` 校验，均不是此次回锁的原因。

---

## 十、怎样可以在刷机时不再擦除 `seccfg`？

修改 `MT6835_Android_scatter.xml`（或配合 `flash.xml` `<scatter>` 指向修改版），或者把 `运行我，刷机.cmd` 的刷机模式改为 `-c download` 都能保留 `seccfg`。

1. 将 `MT6835_Android_scatter.xml` 中 `seccfg`（同理可用于 `lenovolock`）的 `operation_type` 从 `INVISIBLE` 改为 `PROTECTED`（或让 `flash.xml` 的 `<scatter>` 指向改好的副本），`DA_BR.bin` 就会将其纳入白名单而跳过擦除或备份回写。
2. `-c download`。若目标设备 GPT 分区表发生变动（会报错 `"GPT layout change. FW upgrade or Format all first."`）、BROM/DA 认证失败或未解锁状态下刷入未签名镜像，该模式会直接失败。

> [!danger]
> 不要使用 Format All 模式。

---

## 十一、`lk` 是否带有自身的防回滚（ARB）保护？

是，从最早版 `1.1.10.299` 到新版 `1.5.10.321` 从未调高过防回滚版本号。

联想在整个产品周期内始终将 MTK 版本冻结在 `2`、AVB `rollback_index` 冻结在 `0`**，`ar_table` 与 `efuse.img` 也逐字节相同。

因此刷入 `1.5.10.321` 不会触发新的 eFuse 熔断，也不会在硬件层面封死向 `1.1.10.299` 等早期官方固件降级的通道。

不过需特别注意：由于两个时期之间发生过 **AVB 密钥轮换**（`RSA-2048` vs `RSA-4096`），在锁定 Bootloader 的设备上降级或还原旧版时，严禁混刷单个 `lk`、`vbmeta*` 或 `boot` 分区。

---

## 十二、能不能修改 `logo.img`，顺便把“Orange State”解锁提示美化一下？

开机首屏 Logo、关机充电动画与模式界面图可以改，前提是已解锁 Bootloader）；但“Orange State”解锁警告改不了。

拆解 `image/logo.img`（`logo_a`）可见，其内部存放着 121 帧 `1600×2560` 32bpp BGRA8888 `zlib` 压缩图像：`[0]` 是由 `bl2_ext` 显示的开机第一屏（红底 `Lenovo` + `Powered by Android`），其余包括关机充电动画与数字、电池故障警示、`[99]` `FASTBOOT MODE`、`[100]` 模式选择菜单、`[101]` `META MODE` 以及 `[102]` 区域硬件不兼容白屏提示。

如果你想定制这些图像：必须先解锁 Bootloader。`logo` 的 `cert1`/`cert2` 与 ARB 在 Bootloader 锁定时会被强制校验，且 Fastboot 禁止刷写；一旦解锁，`bl2_ext` 与 `lk` 会完全跳过 `cert1`/`cert2`、ARB 与头校验，按原 MKIMG + 121 条目规格打包后即可直接通过 `fastboot flash logo custom_logo.img` 刷入生效。

但 “Orange State”解锁警告文本完全不在 `logo.img` 里，这是 `lk` 内部编码的逻辑，将清除整个屏幕缓冲区后重新绘制解锁警告提示语。修改或去除该提示只能修补 `lk.img`。

---

## 十三、为了缩减下载体积，这个救砖包里哪些文件可以安全删掉？

整个官方救砖包原始包含 **192 个文件，总计 10.76 GiB**（11,558,770,040 B）。结合 `SPFlashToolV6.exe` 的导入依赖与调用逻辑，全部文件按删减安全性可分为三类：

1. A 类：100% 安全可删（144 个文件，可缩减约 1.95 GiB / 2,000 MiB，占 18.15%）：
   - 已被 `super.img` 收纳的散落文件（12 文件，约 1,314.5 MiB）：`system_ext.img`、`vendor.img`、`system_other.img`、`vendor_dlkm.img`、`system_dlkm.img`、`odm_dlkm.img`、5 个 `*.map` 与 `super_empty.img`；
   - 历史测试日志、残留备份与回读文件：`tool/log/`（94 文件，475.0 MiB）、`tool/BackupData/`（5 文件，83.0 MiB，2022 年 `tulip` 设备残留备份）与 `tool/Readback/`（2 文件，2.0 MiB，`ROM_0`/`ROM_1`）；
   - Debug 引导镜像：`image/boot-debug.img` 与 `image/vendor_boot-debug.img`（2 文件，91.3 MiB）；
   - 冗余目录：`image/mtk_unsigned_images/`（13 文件，23.8 MiB）与 `image/download_agent/`（4 文件，0.8 MiB）；
   - 其他旁路残留：`userdata_stripe_0.img` / `userdata_stripe_1.img`（9.3 MiB）、`APDB_MT6835___W2440` / `APDB_MT6835___W2440_ENUM`、`installed-files-ramdisk.txt` / `installed-files-vendor.txt`、`MT6835_Android_scatter.txt`，以及 `tool/` 下的 `ssleay32.dll`、`readback_ui_bak.xsd`、`history.ini`、`write_efuse.xml`、`read_efuse.xml`。
   删掉这 144 个文件后剩 48 个文件（约 8.81 GiB），`运行我，刷机.cmd` 与 GUI 刷机均完全正常。

2. B 类：视场景谨慎裁剪（5 个文件，约 1.30 MiB）：
   - `tool/plugins/platforms/qwindows.dll` 与 `tool/plugins/styles/qwindowsvistastyle.dll`：仅 GUI 模式使用，CLI 脚本不用；但删掉 `qwindows.dll` 后双击 `SPFlashToolV6.exe` 打开图形界面会报错退出；
   - `tool/console_mode.xsd`（仅 `-i <config.xml>` 模式调用）与 `image/da.auth`（2,272 B，仅个别熔断 DAA 设备报 `Need AUTH file` 时需手动指定，建议保留）；
   - `tool/option.ini`（606 B，强烈建议保留）：`SPFlashToolV6.exe` 读取多数参数前未检查键是否存在，删掉后会把 `BaudRate`、`Battery`、`DAChksum`、`StorageLifeCycleCheck` 等默认值覆写为 `-1` 或 `false` 并写回文件。

3. C 类：绝对必须保留的最小集合（43 个文件，约 8.81 GiB）：
   - 根目录（2 文件）：`运行我，刷机.cmd` 与 `notice.txt`（`.cmd` 第 3 行依赖，除非同步改写脚本）；
   - `image/`（29 文件）：`flash.xml`、`flash.xsd`、`DA_BR.bin`、`MT6835_Android_scatter.xml` 以及 Scatter 指定的 25 个刷机镜像（`preloader_sycamore_prc_consumer_wifi.bin`、`vbmeta.img`、`vbmeta_system.img`、`vbmeta_vendor.img`、`spmfw.img`、`pi_img.img`、`dpm.img`、`scp.img`、`vcp.img`、`sspm.img`、`mcupm.img`、`gz.img`、`lk.img`、`boot.img`、`vendor_boot.img`、`init_boot.img`、`dtbo.img`、`tee.img`、`connsys_bt.img`、`efuse.img`、`logo.img`、`super.img`、`lenovoraw.img`、`lenovocust.img`、`userdata.img`）；
   - `tool/`（12 文件）：`SPFlashToolV6.exe` 及其静态导入的 11 个核心 DLL（`flash.dll`、`imageChecker.dll`、`SLA_Challenge.dll`、`libeay32.dll`、`Qt5Core.dll`、`Qt5Gui.dll`、`Qt5Widgets.dll`、`Qt5XmlPatterns.dll`、`Qt5Network.dll`、`Qt5Xml.dll`、`Qt5SerialPort.dll`）。

此外推荐使用 LZMA2 Level 9 压缩缩减体积后的刷机包。

---

## 十四、AVB（`libavb`）是按分区绑定唯一密钥，还是“内置公钥池里任意一把都行”？

它按分区精准绑定唯一公钥，绝对不会把 `lk.img` 里的内置公钥当成通用钥匙池来通认各个分区。

反汇编 `lk.img` 中的 `load_and_verify_vbmeta()` 可见，`libavb` 保留了三条互斥的验签分支，严格隔离不同分区的公钥信任边界：

1. Chain Partition 链式子分区（`boot`、`vbmeta_system`、`vbmeta_vendor` 等）：校验时根本不查询 `lk` 内置公钥，而是直接把该分区 `AVB0` 头携带的公钥与父级 `vbmeta` 中对应 `AvbChainPartitionDescriptor` 写死的 `public_key` 做逐字节比对（例如 `1.1.10.299` 中这 3 个分区的公钥全都不在 `lk.img` 内部）。哪怕改用 `lk` 内置的另一把公钥来签，只要与父级链式描述符不一致就会直接报错拒启。
2. 顶层 `vbmeta` 分区：由于没有父级 `vbmeta`，才路由至 `ops->validate_vbmeta_public_key`。本机 `lk.img` 未实现多公钥池，也未编译 `avb_custom_key`，仅校验密钥位数并与唯一硬编码的 `lk_avb_key` 做内存比对。
3. 脱离 `vbmeta` 独立校验的 `recovery` 分区：在 `AVB_SLOT_VERIFY_FLAGS_NO_VBMETA_PARTITION` 模式下路由至 `ops->validate_public_key_for_partition`，该函数显式检查分区名是否为 `"recovery"`——只要不是 `"recovery"` 就直接拒签，且仅与硬编码的 recovery 专属公钥比对（`1.1.10.299` 中两把公钥即各不相同，`1.5.10.321` 只是巧合填成了同一把 OEM RSA-4096 公钥）。
4. 普通非链式分区（`dtbo`、`init_boot`、`vendor_boot` 以及 `super` 内的 `system`、`vendor`、`product`、`system_ext`、`*_dlkm`）：自身 `Algorithm: NONE`，直接由上级 `vbmeta` / `vbmeta_system` / `vbmeta_vendor` 中的 `Hash` / `Hashtree` 描述符锁定摘要，不单独进行非对称公钥验签。

---

## 十五、能不能把非链式分区加上签名 Footer 后改造成 Chain Partition？

只要目标是物理 GPT 分区且满足 `libavb` 与 `vbmeta` 信任链的结构约束，规范允许改造成 Chain Partition 并可通过校验；但 `super` 内的 LP 逻辑分区不能直接这么做。

`libavb` 本身并未按分区名称限制“谁能成为链式分区”（`boot.img` 自身就是自带签名 Footer + 顶层 `vbmeta` 链式引用的范例），但实测 `lk.img` 确认必须满足以下全部条件：

1. 仅限物理 GPT 分区，不能直接用于 `super` 内的逻辑分区：`lk.img` 的 `read_from_partition` 只按 GPT 读取物理分区（如 `boot`、`vendor_boot`、`init_boot`、`dtbo`），不解析 `super` 内的 LP 元数据，因此 `system`、`vendor`、`product`、`system_ext`、`*_dlkm` 无法直接挂进顶层 `vbmeta` 的链式列表，必须仍经由物理 `vbmeta_system` / `vbmeta_vendor` 间接校验。
2. 必须同步修改并用主根私钥重签顶层 `vbmeta.img`：仅在目标分区末尾加上签名 `AVBf` Footer 不够，还必须删除顶层 `vbmeta.img` 中该分区原有的 `Hash` 描述符，改为写入对应的 `AvbChainPartitionDescriptor`（绑定分区名、新公钥和 `rollback_index_location` / RIL），再用 `lk` 信任的主根私钥重签顶层 `vbmeta.img`（新链式分区自身可使用独立密钥对，不要求与顶层相同）。
3. 仅允许一级链式引用，禁止嵌套，且 RIL 与总数不能超限：`Chain Partition` 描述符只允许出现在顶层 `vbmeta` 中，禁止放进 `vbmeta_system` 等子级 `vbmeta` 内；整个信任链的 `vbmeta` 镜像总数不得超过 `32` 个；`rollback_index_location`（RIL）须满足 `1 <= RIL < 32` 且避开已占用的 `0..4`（从 `5` 起分配）。
4. Footer 状态与分区体积合规：目标分区末尾 64 B `AVBf` Footer 指向的 `AVB0` 头须满足 `flags == 0`、头内 `rollback_index_location == 0`、`Hash` 描述符中的 `partition_name` 与实际分区名一致，且总大小不超过该物理 GPT 分区的容量上限。
