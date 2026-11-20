# TB335FC（MT6835）官方救砖包技术分析报告

> [!important]
> 未经过人工润色但是内容正确性已核验。剩下的不明确处：
>
> 1. 设备是否真的尊重 `seccfg` 的配置？
> 2. 设备是否可以通过深度刷机模式或临时 Root 读写 `seccfg`？
> 3. SP Flash 是否在这台设备上支持 Download 模式写固件？
>
> 这些问题在我这不会有答案，没有多余资金用于购买一台性能明显低于我当前使用产品的设备专门用于测试。

- **目标设备 / 芯片平台**：联想 TB335FC / 联发科 MT6835
- **工程代号 / 系统版本**：`sycamore_prc_consumer_wifi` / ZUXOS `1.5.10.321`（ALPS 基线 `alps-mp-t0.mp1-V13.17.3`，编译打包时间 `2026-09-08 03:47:42`，`flash.xml` 修改于 `2026-09-18 17:38:26`）
- **分析目录**：`d:\TB335FC_ZUXOS_1.5.10.321_Tool`（全程只读取证，共 192 个文件，11,558,770,040 字节 / 10.7649 GiB）

---

## 1. `image\mtk_unsigned_images` 为何存在，是否真为未平台签名镜像？

### 1.1 结论

1. **是否为未签名镜像**：`image\mtk_unsigned_images` 下的 13 个文件中，**12 个确实未经过 MTK 平台安全启动签名**（其中 `scp.img`、`vcp.img` 还是**未加密明文**），而外层 `image\` 中对应的 12 个文件均已完成 MTK Verified Boot v2 签名（及针对 `scp`/`vcp` 的加密）。**唯一的例外是 `efuse.img`（512 B）**：内外两处逐字节完全一致。
2. **为何存在于公开救砖包中**：这是 MTK 编译流程中 `sign-image` / `sign_flow.py` 生成的**构建中间备份目录**。由于联想制作救砖包时直接打包了编译产物输出目录而未做清理，`mtk_unsigned_images\` 连同 `APDB_*`、`*.map`、`installed-files-*.txt`、`*-debug.img` 及 2022 年遗留 `tool\log\` 一并留在了分发包中。该目录下的任何文件**均未被** `MT6835_Android_scatter.xml`、`MT6835_Android_scatter.txt`、`flash.xml` 或 `运行我，刷机.cmd` 引用，实际刷机时完全不会刷入。

### 1.2 二进制结构与逐文件对比证据

- **容器与签名机制**：
  - 上述 12 个固件均为 MTK MKIMG 容器格式（主头魔数 `0x58881688` + 扩展头魔数 `0x58891689`，每段头长 512 B，16 B 对齐）。全部 26 个文件末尾 128 B 均**不存在** AVB 脚标（`AVBf`）。
  - `mtk_unsigned_images\` 中的 12 个文件每个子镜像仅包含裸 MKIMG 头与载荷，`img_type=0x0`，无任何 `cert1`/`cert2` 段。
  - 外层 `image\` 中对应的 12 个文件在每个子镜像之后插入了一对 X.509 ASN.1 DER 证书段（12 个文件合计 22 对）：
    - **`cert1`**（`img_type=0x02000000`，`maddr=0x12345678`，`maddr_ext=0x22345678`）：`dsize=0x6c5`（1,733 B DER + 11 B 对齐 + 512 B MKIMG 头 = **2,256 B**）。内含根 RSA-2048 公钥、镜像 RSA-2048 公钥（OID `2.16.886.2454.1.2`）及 524 B `mtk_key` 数据块（OID `2.16.886.2454.1.1`），采用 `rsassaPss`（`sha256` + `mgf1(sha256)`，salt=32）签名；所有 22 个 `cert1` 共享同一 `C=AU, ST=Some-State, O=Mediatek` 签发者前缀。
    - **`cert2`**（`img_type=0x02000002`）：
      - **10 个未加密镜像**：`dsize=0x3e3`（995 B DER + 13 B 对齐 + 512 B 头 = **1,520 B**），每个子镜像共增加 **3,776 B**（`2,256 + 1,520`）。`2.16.886.2454.2.1` 记录对齐后载荷的 SHA-256，`2.16.886.2454.2.4` 记录 512 B MKIMG 头的 SHA-256；除最后一个 `cert2` 置位 `img_list_end` 外，子镜像载荷与 `mtk_unsigned_images\` 逐字节相同。
      - **`scp.img` 与 `vcp.img`（签名 + 加密）**：`cert2` `dsize=0x423`（1,059 B DER + 13 B 对齐 + 512 B 头 = **1,584 B**），每个子镜像共增加 **3,840 B**（`2,256 + 1,584`）。`mtk_unsigned_images\` 中载荷为明文；签名后的外层文件中，载荷经加密（`2.16.886.2454.2.9 = 0x010000`）并向上填充至 16 B AES 块边界（如 `tinysys-scp-RV55_A` 由 `0xda485` 扩为 `0xda490`、`tinysys-vcp-RV33_A_dram` 由 `0x130f68` 扩为 `0x130f70`），`2.16.886.2454.2.1` 校验密文 SHA-256，`2.16.886.2454.4.2` 记录明文载荷 SHA-256，`2.16.886.2454.2.8` 存放 32 B 加密参数。
- **13 个文件尺寸、增量与 SHA-256 前缀总表**：

| 文件名 | 未签名版 (B) | 外层版 (B) | 增量 (B) | 子镜像组成 | 未签名 SHA-256 / 外层 SHA-256（前 16 位） |
| --- | ---: | ---: | --- | --- | --- |
| `connsys_bt.img` | 4,284,192 | 4,287,968 | +3,776 (1×3,776) | `connsys_bt` | `1b3f0dbc63797d95` / `ad605458fd8ee257` |
| `dpm.img` | 137,104 | 148,432 | +11,328 (3×3,776) | `dpmpm`, `dpmdm`, `dpmpt` | `a1e3351fada6e643` / `9d6d1b76fc8bcdd2` |
| `efuse.img` | 512 | 512 | **0（完全一致）** | *（非 MKIMG）* | `524abce23f56a536` / `524abce23f56a536` |
| `gz.img` | 1,793,728 | 1,801,280 | +7,552 (2×3,776) | `gz`, `unmap2` | `b8e0da7541befb8a` / `f07d8c0d0419d570` |
| `lk.img` | 3,395,456 | 3,414,336 | +18,880 (5×3,776) | `lk`, `bl2_ext`, `aee`, `lk_main_dtb`, `lk_dtbo` | `7f00943a70998cae` / `d6e02b322f282b17` |
| `logo.img` | 6,366,384 | 6,370,160 | +3,776 (1×3,776) | `logo` | `666f463d39930740` / `96196815b76e31b5` |
| `mcupm.img` | 126,176 | 129,952 | +3,776 (1×3,776) | `tinysys-mcupm-RV33_A` | `ab16334648ef3436` / `a3b4713dbd466d5c` |
| `pi_img.img` | 27,488 | 31,264 | +3,776 (1×3,776) | `pi_img` | `6f331a1b987ef3d5` / `6bed51658ae96c1b` |
| `scp.img` | 3,481,168 | 3,488,848 | +7,680 (2×3,840) | `tinysys-scp-RV55_A`, `_dram` *（已加密）* | `7fba3b39c8c58a50` / `2c2ac21dd064e9d2` |
| `spmfw.img` | 11,600 | 15,376 | +3,776 (1×3,776) | `spmfw` | `52a26e1953131677` / `edb1b679d367821a` |
| `sspm.img` | 750,912 | 754,688 | +3,776 (1×3,776) | `tinysys-sspm` | `df774df20bf31ddb` / `1332e28cadc76b49` |
| `tee.img` | 3,254,544 | 3,262,096 | +7,552 (2×3,776) | `atf`, `tee` | `1b4290fc08370d49` / `edffc5c0dec2b60b` |
| `vcp.img` | 1,377,648 | 1,385,328 | +7,680 (2×3,840) | `tinysys-vcp-RV33_A`, `_dram` *（已加密）* | `caba78dee0568877` / `68806d3f8ef95d67` |

- **`efuse.img`（512 B）内部结构**：两份文件 SHA-256 均为 `524abce23f56a536327328a027e0b385f330b4334c57e1b33769de00e9f3ebc1`，属于 MTK **EFUSE Self-Blow** 专用二进制结构：
  - `0x000..0x007`：魔数 `f6 e2 b1 90 c9 a8 d5 73`；
  - `0x01c..0x03b`：`d250e9e2b53151d1c9ba7451fdc1382187127edcf82ffe08a0f1e57728e7f943` —— **严格等于 `cert1` 内 524 B `mtk_key`（OID `2.16.886.2454.1.1`）根公钥块的 SHA-256**（`sbc_key_hash`）；
  - `0x070..0x073`：`0x00000046`（对应 Preloader `[EFUSE]` 的 SBC/DAA/JTAG 控制位）；
  - `0x1e0..0x1ff`：`75959b80444aac54845550307e6cfab66f5818f56b619bbcfa2abc18150ddb6e` —— 前 480 字节（`0x000..0x1df`）的 SHA-256 脚标摘要。因其不采用 MKIMG 证书结构，`sign-image` 直接原样复制保留。

---

## 2. 为何 `image\download_agent\flash.xml` 与 `image\flash.xml` 一致且存在两份？

### 2.1 一致性验证

`image\download_agent\` 下的**全部 4 个文件**与 `image\` 根目录下的同名文件在内容和修改时间（`LastWriteTime`）上均**逐字节一致**：

| 文件 | 大小 (B) | SHA-256 | 最后修改时间 |
| --- | ---: | --- | --- |
| `DA_BR.bin` | 853,564 | `cc5162b3f171df38c04b2f871f5fd739af48721dd830afe893a06a1ce4c97940` | `2026-09-08 04:04:23.60` |
| `da.auth` | 2,272 | `18dd5c886aed626f644009532be8d31ef810f7a77f3160834e24dbc7a304d8e0` | `2026-09-08 04:04:23.60` |
| `flash.xsd` | 653 | `1720850c300aa960611fe67ec10eb2dccf5df9fda18615e97c9abce7f9b2e058` | `2026-09-08 04:04:23.60` |
| `flash.xml` | 368 | `0ade9eeede7379b1d46a6f17cf9d7319fdaf7883003e5bf4af415975e1256b12` | `2026-09-18 17:38:26.26` |

### 2.2 成因分析

1. **MTK 标准构建目录布局**：在 MTK Android 编译合包阶段，Download Agent 相关引导描述文件默认输出到 `merged/download_agent/` 子目录下（在最早公开版本 `1.1.10.299`（`2025-05-09`）的包中即只有 `image\download_agent\flash.xml`，其 `<scatter>` 写为 `../MT6835_Android_scatter.xml` 且外层 `image\` 无副本；`tool\history.ini` 与 `tool\log\` 中留存的其它项目如 `TB350FU` 亦采用同样的上级相对路径）。
2. **SP Flash Tool V6 相对路径解析机制**：反汇编 `tool\SPFlashToolV6.exe`（`FlashXMLParser`）与 `tool\flash.dll` 可知：
   - `FlashXMLParser::isValidXMLSchema`（`0x486de0`）强制在同一目录下查找 `flash.xsd`（`QFileInfo(flash_xml).absolutePath() + "/flash.xsd"`）；
   - 解析 `<scatter>`（`0x4870af`）与 `<dagent>`（`0x48727e`）时调用同一路径拼接函数（`0x486c50`）：若为相对路径，则**相对于 `flash.xml` 所在目录**解析。
3. **本包的实际配置与打包操作**：本包 `flash.xml` 中 `<dagent>DA_BR.bin</dagent>` 与 `<scatter>MT6835_Android_scatter.xml</scatter>` 均写成**同级裸文件名**（无 `..\`）。若直接将 `image\download_agent\flash.xml` 传给刷机工具，会因 `image\download_agent\MT6835_Android_scatter.xml` 不存在而报错。因此工程人员在 2026-09-18 改写或统一定稿了 `flash.xml`，将 `download_agent\` 下的 4 个文件直接复制到 `image\` 根目录以便与 `MT6835_Android_scatter.xml` 同级放置，同时保留了原 `image\download_agent\` 目录并将最新版 `flash.xml` 同步留存两处；`运行我，刷机.cmd` 最终仅通过 `-f %~dp0image\flash.xml` 调用外层副本。

---

## 3. `image\flash.xsd` 的用途与记载信息

### 3.1 用途与校验机制

- `image\flash.xsd`（653 B）是标准 W3C XML Schema 定义文件（`http://www.w3.org/2001/XMLSchema`，`elementFormDefault="qualified"`）。
- `SPFlashToolV6.exe` 在加载刷机入口文件时，经 `FlashXMLParser::isValidXMLSchema()` -> `ConsoleMode::SchemaValidator::Validate()` 调用 `Qt5XmlPatterns.dll`（`QXmlSchema` / `QXmlSchemaValidator`），使用**与被加载 XML 同目录的 `flash.xsd`** 进行结构校验。
- 结合 `tool\log\*\QT_FLASH_TOOL_V6.log`（如 `06-24-2022-11-01-13`、`07-20-2022-20-29-45`）可见：若缺失 `flash.xsd` 或误将 `MT6835_Android_scatter.xml` 直接当作入口文件加载，Schema 校验即刻失败并抛出提示 `... is invalid. Please select the ./download_agent/flash.xml in the load.`。

### 3.2 Schema 字段与 `flash.xml` 映射表

`flash.xsd` 定义根元素 `<flash-mode>`（类型 `flashInfo`），要求严格按 `xs:sequence` 顺序包含以下 7 个必选 `xs:string` 元素：

| 序号 | Schema 元素名 | 类型 | `image\flash.xml` 实际值 | `SPFlashToolV6.exe` 实际解析行为 |
| ---: | --- | --- | --- | --- |
| 1 | `project` | `xs:string` | `sycamore_prc_consumer_wifi` | 仅作工程标识元数据，解析器未读取 |
| 2 | `dagent` | `xs:string` | `DA_BR.bin` | 在 `0x487240` 及 `flash.dll`（`0x1003fa72`）解析，确定 Download Agent 路径 |
| 3 | `scatter` | `xs:string` | `MT6835_Android_scatter.xml` | 在 `0x487064` 解析，确定分区散列表路径 |
| 4 | `build_version` | `xs:string` | `alps-mp-t0.mp1-V13.17.3` | MTK ALPS BSP 基线版本号（仅元数据） |
| 5 | `build_time` | `xs:string` | `2026-09-08 03:47:42` | 镜像打包时间（仅元数据） |
| 6 | `version` | `xs:string` | `1.0` | XML 描述格式版本（仅元数据） |
| 7 | `contact` | `xs:string` | `Fengping.Yu` | 在 `0x4870c9` 解析至 `contact` 字段，报错时提示联系人信息 |

---

## 4. `APDB_MT6835___W2440` 与 `APDB_MT6835___W2440_ENUM` 的用途

- **文件内容与内部结构**：
  - **`image\APDB_MT6835___W2440`**（227,555 B）：MTK **`CATD`** 二进制 C 类型/NVRAM 结构数据库（头部魔数 `43 41 54 44` = `CATD`，末尾为 `LLEN` 结束标记，共含 7,396 条 ASCII 符号字符串），记录了 **80 个唯一 `AP_CFG_*_LID`**（NVRAM 逻辑项定义）及 187 组 C 结构体布局与字段对齐信息，主要涵盖：
    - 音频参数与增益校准（`_AUDIO_ACF_CUSTOM_PARAM_STRUCT`、`AP_CFG_RDCL_FILE_AUDIO_*_LID`）；
    - 相机 3A / 对焦 / 阴影 / Pline 调优数据（`AP_CFG_RDCL_CAMERA_*_LID`）；
    - 无线连接校准与地址（Wi-Fi `WIFI_CFG_PARAM_STRUCT`、蓝牙 `ap_nvram_btradio_mt6610_struct`、GPS）；
    - 传感器 / 电量计 / SmartPA 校准（`HWMON_{ACC,GYRO,PS}`、`FUEL_GAUGE`、`SMARTPA_CALIB`）；
    - 产线设备与出厂身份信息（`AP_CFG_REEB_PRODUCT_INFO_LID` / `PRODUCT_INFO`、`AP_CFG_RDCL_FACTORY_LID`）。
  - **`image\APDB_MT6835___W2440_ENUM`**（20,797 B）：纯文本定宽枚举表（共 287 行），将 `AP_CFG_*_LID` 编号（`0..78`，例如 `AP_CFG_FILE_VER_INFO_LID = 0`、`AP_CFG_REEB_PRODUCT_INFO_LID = 61`、`AP_CFG_CUSTOM_FILE_MAX_LID = 78`）以及 `AUDIO_GAIN_*`、`VOL_*`、`MOD_*`、`*_SAP`、`MSG_ID_*`、`TRACE_*` 等枚举符号映射为具体整数值（文件名中的 `W2440` 为 MTK 数据库构建周次标识）。
- **消费工具与在包内存在原因**：
  - **刷机完全不使用**：`SPFlashToolV6.exe`、`flash.dll` 与 scatter 文件中对 `APDB`/`CATD` 均为零引用。
  - **真实消费者**：供 **MTK META Mode 产线与售后工具**（如 SP META、ModemMETA、SN Writer、Audio Tuning Tool、Catcher）在 PC 端按准确字节偏移序列化/反序列化设备 `nvram`/`nvdata`/`proinfo` 中的射频、音频、传感器校准及 SN/MAC 地址。它出现在此包中同样是因为从 `out/target/product/sycamore_prc_consumer_wifi/` 复制打包时未剔除。

---

## 5. 目录内各个非 AOSP 设施镜像的用途

按题目给定，AOSP 设施包括 13 项：`boot`、`dtbo`、`init_boot`、`super`、`system_dlkm`、`system_ext`、`system_other`、`userdata`、`vbmeta`、`vbmeta_system`、`vbmeta_vendor`、`vendor`、`vendor_boot`。`image\` 内其余全部非 AOSP 镜像、二进制及衍生文件清单如下：

### 5.1 引导加载程序、刷机代理与认证文件（3 个）

| 文件名 | 大小 (B) | Scatter 分区与属性 | 二进制特征与架构用途 |
| --- | ---: | --- | --- |
| `preloader_sycamore_prc_consumer_wifi.bin` | 395,248 | `preloader`（`EMMC_BOOT1`/`UFS_LU0`）与 `preloader_backup`（`EMMC_BOOT2`/`UFS_LU1`），`dl=true`，`op=BOOTLOADERS`，`type=SV5_BL_BIN` | MTK GFH（`MMM\x01`）一级引导（BL2），含 `AND_ROMINFO_v` 与内存 `EMI` 参数表；由芯片 BootROM 加载，完成 PMIC/时钟/DRAM 初始化、校验 eFuse SBC/SLA 并加载后续引导阶段 |
| `DA_BR.bin` | 853,564 | 未入 Scatter（由 `flash.xml` `<dagent>` 指定） | 头部 `MTK_DOWNLOAD_AGENT`（版本 `MTK_DA_v6_2026-01-06 20:05:10`），内含 PMIC 与存储驱动；线刷时通过 USB 写入设备 SRAM/DRAM，负责执行全部分区读写、GPT 重建与备份恢复 |
| `da.auth` | 2,272 | 未入 Scatter（`download_agent\` 亦有同本） | MTK GFH（`MMM\x01`，3 个 GFH 头）签名认证文件；设备开启 DAA/SLA 校验时用于向 BootROM/Preloader 证明刷机权限 |

### 5.2 MTK SoC 底层固件、TEE/Hypervisor、Logo 与 eFuse（13 个）

除 `efuse.img` 外，以下 12 个均为带有 `cert1`（1,733 B）+ `cert2`（995 B 或 1,059 B）的 MKIMG 容器；在 `MT6835_Android_scatter.xml`（EMMC 与 UFS 两套描述）中均仅刷写 `*_a` 槽位（`is_download="true"`，`op=UPDATE`），对应 `*_b` 槽位均为 `is_download="false"` / `INVISIBLE`：

| 文件名 | 大小 (B) | Scatter 目标 | 内部子镜像及详细职责 |
| --- | ---: | --- | --- |
| `lk.img` | 3,414,336 | `lk_a`（16 MiB） | 含 5 个子镜像：`lk`（949,296 B，Little Kernel AP 主引导 + Fastboot + AVB 2.0）、`bl2_ext`（1,038,096 B，BL2 扩展加载器）、`aee`（958,808 B，MTK 异常崩溃转储模块）、`lk_main_dtb`（192,055 B，`mediatek,MT6835` 设备树）、`lk_dtbo`（254,609 B，外设覆盖层） |
| `tee.img` | 3,262,096 | `tee_a`（5 MiB） | 含 2 个子镜像：`atf`（254,216 B，ARM Trusted Firmware EL3，安全监控与 DEVMPU 隔离）、`tee`（2,999,296 B，`MTK TEE` 头，豆荚 Beanpod/ISEE Soter510：`lenovo_HQ_MT8755_T_ISEE500_DRM_RPMB_Sycamore_systemV`，提供 Keymaster/DRM/RPMB 安全执行环境） |
| `gz.img` | 1,801,280 | `gz_a`（32 MiB） | 含 2 个子镜像：`gz`（1,648,128 B，MTK GenieZone EL2 Hypervisor）、`unmap2`（144,576 B，ELF64 EL2 Stage-2 内存解映射器，隔离 `atf-reserved`/`tee-reserved` 安全内存） |
| `scp.img` | 3,488,848 | `scp_a`（6 MiB） | 含 2 个加密子镜像：`tinysys-scp-RV55_A`（894,096 B）与 `tinysys-scp-RV55_A_dram`（2,586,048 B）。MTK 系统协处理器（RISC-V RV55）RTOS 固件，运行低功耗传感器中枢（Sensor Hub）与唤醒任务 |
| `vcp.img` | 1,385,328 | `vcp_a`（6 MiB） | 含 2 个加密子镜像：`tinysys-vcp-RV33_A`（127,488 B）与 `tinysys-vcp-RV33_A_dram`（1,249,136 B）。MTK 视频协处理器（RISC-V RV33，`vcp@1ec00000`）固件，协助卸载视频编解码与显示控制 |
| `sspm.img` | 754,688 | `sspm_a`（1 MiB） | `tinysys-sspm`（750,398 B）。MTK 安全系统功耗管理器（`sspm@1c340000`）固件，负责温控、DVFS 与系统功耗监测（SWPM） |
| `mcupm.img` | 129,952 | `mcupm_a`（1 MiB） | `tinysys-mcupm-RV33_A`（125,652 B）。MTK MCU 功耗管理器（RV33）固件，控制 CPU 集群调频（`fhctl-mcupm`）与核心休眠 |
| `dpm.img` | 148,432 | `dpm_a`（4 MiB） | 含 3 个子镜像：`dpmpm`（15,788 B）、`dpmdm`（132 B）、`dpmpt`（119,622 B）。MTK DRAM 功耗管理器固件，管控内存低功耗状态与调频 |
| `spmfw.img` | 15,376 | `spmfw_a`（1 MiB） | `spmfw`（11,075 B，`SPM3` 头）。MTK 系统功耗管理微码，负责深度待机（Suspend-to-RAM）状态机 |
| `pi_img.img` | 31,264 | `pi_img_a`（1 MiB） | `pi_img`（26,964 B）。MTK 早期平台初始化（Platform Initialization）扩展模块，由 `bl2_ext`/LK 加载 |
| `connsys_bt.img` | 4,287,968 | `connsys_bt_a`（8 MiB） | `connsys_bt`（4,283,672 B，含 `bt_cos_adp.c` / `CONNSYS TOP ISR`）。MTK Connsys 无线连接子系统蓝牙核固件 |
| `logo.img` | 6,370,160 | `logo_a`（16 MiB） | `logo`（6,365,858 B）。包含 121 帧 `zlib` 压缩界面图，供 LK / `bl2_ext` 显示开机 Logo、充电动画、Fastboot 与模式菜单 |
| `efuse.img` | 512 | `efuse`（512 KiB） | 非 MKIMG；MTK EFUSE Self-Blow 配置数据，携带 SBC 公钥哈希与熔丝校验标志 |

### 5.3 联想 OEM 专属镜像（2 个）

| 文件名 | 大小 (B) | Scatter 分区与属性 | 二进制特征与用途 |
| --- | ---: | --- | --- |
| `lenovocust.img` | 314,572,800 | `lenovocust`（300 MiB，`dl=true`，`op=UPDATE`，`type=EXT4_IMG`） | 原始 EXT4 镜像（魔数 `0xef53`，76,800 × 4 KiB 块，UUID `6ba47dfd21ac4471a9ebde2366214e64`，无 AVB 脚标），内部仅含 `/` 与 `lost+found`（已用 11 个 inode），用于清空并格式化联想定制/预装分区 `/lenovocust` |
| `lenovoraw.img` | 16,777,216 | `lenovoraw`（16 MiB，`dl=true`，`op=UPDATE`，`type=NORMAL_ROM`） | **100% 全 `0x00`**。用于在刷机时重置联想自定义裸元数据分区 `lenovoraw`（LK 会从该分区读取 `csdk_cofig.flash_dis`、`custLogo_enable` 等标记） |

### 5.4 题目 13 项清单之外的 AOSP 衍生与辅助文件（均未入 Scatter）

- `odm_dlkm.img`（348,160 B）与 `vendor_dlkm.img`（13,451,264 B）：AOSP GKI/Treble 厂商动态内核模块 EROFS 分区（带 `avbtool 1.2.0` 脚标），已打入 `super.img`。
- `super_empty.img`（5,288 B）：`lpmake` 生成的空 LP 元数据模板（`0x616c4467` 几何块 + `0x414c5030` v10.2 头，14 个零 extent 分区），供 `fastboot wipe-super` 使用。
- `userdata_stripe_0.img`（5,509,480 B）与 `userdata_stripe_1.img`（4,202,736 B）：由后处理条带切分工具在 `userdata.img`（`04:05:21`）生成约 7 分钟后（`04:12:27`）按 1 MiB 交错拆分而成的双通道条带版稀疏镜像（各占 393,216 × 4 KiB 虚拟块 = 1,536 MiB，合并即 3,072 MiB 的 `userdata.img`），SPFT 刷机只刷 `userdata.img`。
- `boot-debug.img`（67,108,864 B）与 `vendor_boot-debug.img`（28,581,888 B）：调试引导镜像（详见第 8 节）。
- 元数据文件：`*.map`（`system_ext.map`、`vendor.map`、`vendor_dlkm.map`、`system_dlkm.map`、`odm_dlkm.map`，OTA `blockimgdiff` 块映射）、`installed-files-ramdisk.txt` / `installed-files-vendor.txt`（文件尺寸清单）、`MT6835_Android_scatter.txt`（旧版文本格式 Scatter）。

---

## 6. 为何 `super` 内的逻辑分区文件会单独出现在包内，而不是打入 `super` 再分发？

### 6.1 事实澄清：它们已全部打入 `super.img`，且包内并不存在 `system.img` 与 `product.img`

- **实际存在的散落逻辑镜像（共 6 个）**：`vendor.img`、`system_ext.img`、`vendor_dlkm.img`、`system_dlkm.img`、`odm_dlkm.img`、`system_other.img`。
- **实际不存在的文件**：目录中**没有** `system.img`、`product.img`（也无 `odm.img`）。
- **解析 `super.img`（Android 稀疏镜像，虚拟容量 11,264.00 MiB / 2,883,584 × 4 KiB 块，LP v10.2 元数据含 `default`/`main_a`/`main_b` 3 组共 14 个分区）提取各逻辑分区并计算 SHA-256，结果与散落文件完全对应**：

| `super.img` 内逻辑分区 | 分区组 | 起始扇区 | 精确字节数 | 与包内散落文件的 SHA-256 逐字节比对 |
| --- | --- | ---: | ---: | --- |
| `odm_dlkm_a` | `main_a` | 2,048 | 348,160 | **100% 一致**（`odm_dlkm.img`，`5773135a2bfde9a9...`） |
| `product_a` | `main_a` | 4,096 | 831,401,984 | *（无散落文件）* |
| `system_a` | `main_a` | 1,628,160 | 6,734,848,000 | *（无散落文件）* |
| `system_b` | `main_b` | 14,782,464 | 245,964,800 | **100% 一致**（`system_other.img`，`a1212bf947a6afed...`，含预优化 `.odex`/`.vdex`/`.art`） |
| `system_dlkm_a` | `main_a` | 15,263,744 | 348,160 | **100% 一致**（`system_dlkm.img`，`988093c38026555a...`） |
| `system_ext_a` | `main_a` | 15,265,792 | 589,438,976 | **100% 一致**（`system_ext.img`，`040b766531317934...`） |
| `vendor_a` | `main_a` | 16,418,816 | 528,646,144 | **100% 一致**（`vendor.img`，`fc9005acd1f000c2...`） |
| `vendor_dlkm_a` | `main_a` | 17,453,056 | 13,451,264 | **100% 一致**（`vendor_dlkm.img`，`6b3ff9228fd7b525...`） |
| `*_b`（除 `system_b` 外 6 个） | `main_b` | — | 0 | 空占位分区 |

- **Scatter 引用情况**：`MT6835_Android_scatter.xml` 仅刷写 `super`（`super.img`，`0x2c0000000`），**6 个散落逻辑镜像、`.map` 及 `super_empty.img` 均不在 Scatter 中**。

### 6.2 为何依然保留在救砖包中（Split-Build 构建流实证）

通过解析镜像内 EROFS `build.prop` 与 AVB 脚标，可以还原完整的双树分离编译（Split-Build）与合并打包过程：

1. **MSSI 系统编译树**（`mssi_t_64_cn_armv82_wifi`，Android 16 SDK 36，`BP2A.250605.031.A3`，`avbtool 1.3.0`，构建于 `2026-09-08 02:19:25 CST`）产出 `system`、`product`、`system_ext`、`system_other`（`system_b`）及 `system_dlkm` 文件内容；
2. **Vendor/BSP 厂商树**（`sycamore_prc_consumer_wifi`，Vendor SDK 33 / `AP3A.240905.015.A2`，`avbtool 1.2.0`，构建于 `03:43:30 CST`）产出 `vendor`、`vendor_dlkm`、`odm_dlkm`，在 `merge_target_files` / `build_super_image` 合并阶段对 `system_dlkm.img` 用厂商密钥重签了 AVB 脚标（因此 `system_dlkm.img` 内部 `build.prop` 来自 MSSI，但 AVB 脚标版本为 `avbtool 1.2.0` 与 `Lenovo/TB335FC/.../260908_321:user/release-keys`），并于 `04:04:12` 由 `lpmake` 汇总生成 `super.img`。
3. AOSP/MTK 的产物暂存目录会保留各子分区原始 `.img`、`.map` 与 `super_empty.img` 以供 `lpmake`、`blockimgdiff` 及 `fastbootd` 单分区调试刷写。联想在封包发布时仅移除了体积最大的 `system.img`（~6.27 GiB）和 `product.img`（~793 MiB）（或合并脚本仅临时展开这两者），未同步剔除其余约 1.3 GiB 的逻辑分区镜像与元数据，造成了“既有 `super.img` 又附带零散逻辑分区镜像”的冗余现象。

---

## 7. `lk.img` 是否负责 AVB 验签？按 AOSP `avbtool.py` 算法提取其 AVB 公钥 SHA1

### 7.1 结论

**是，`lk.img` 负责执行 AVB 2.0 验签。** 按照 AOSP `avbtool.py` 算法计算得到其内嵌 AVB 公钥的 **`Public key (sha1)`** 为：

```text
8fcb864f11f53ed11284615fb67685522085d3a2
```

*(完整 1,032 B `AvbRSAPublicKey` 序列化块的 SHA-256 为 `7b34b55104c8f0f48ae3763b1b20990aa9f8f5f0dffb838d7e31ef506c819281`。)*

### 7.2 本机 `avbtool` 检查与 AOSP 公钥 SHA1 算法

- 核对 `F:\GitHub\avbpowertool2\`：
  - `avbtool_reference.py`（210,144 B）为未修改的原生 **AOSP `avbtool 1.3.0`**；
  - `avbtool.py`（216,385 B）仅加入了 `PATCH-CRYPTO`（内置 `cryptography` 回退替代 `openssl`）与 `PATCH-FEC` 补丁，二者执行 `info_image` 输出完全一致。
- **AOSP `avbtool.py` 算法**（`RSAPublicKey.encode()` 第 409–433 行与 `Avb.info_image()` 第 2418–2442 行）：
  - 固定公钥指数 $e = 65537$；
  - 将模数 $N$ 序列化为大端字节序结构体 `AvbRSAPublicKeyHeader + modulus + RR`：
    `struct.pack('!II', num_bits, n0inv) + modulus_be + rrmodn_be`
    其中 `n0inv = 2^32 - modinv(N, 2^32)`，`rrmodn = (2^bit_length)^2 mod N`（对于 RSA-4096 共 **1,032 B**）；
  - 最后对这 1,032 字节序列化数据计算 `hashlib.sha1(key_blob).hexdigest()`。

### 7.3 `lk.img` 负责 AVB 验签与公钥位置的二进制证据

1. **容器结构**：`image\lk.img`（3,414,336 B）包含 5 个子镜像（`lk`、`bl2_ext`、`aee`、`lk_main_dtb`、`lk_dtbo`）及各自 `cert1`/`cert2`。首个子镜像 `lk` 位于文件偏移 `0x200..0xe7e30`（AArch64，加载基址 `0xffff000050f00000`），与 `mtk_unsigned_images\lk.img` 中的 `lk` 载荷逐字节一致。
2. **`libavb` 实现与调用链**：`lk` 内编译了完整 `libavb`（`app/mt_boot/avb/load_vfy_boot.c`、`avb_slot_verify.c`、`avb_vbmeta_image.c`、`avb_rsa.c` 等），由 `load_vfy_boot`（`lk+0x4e290`）调用 `avb_slot_verify`（`lk+0x94b58`）验证 `boot`/`recovery` 并注入 `androidboot.verifiedbootstate={green,yellow,orange,red}` 与 `androidboot.vbmeta.*`。
3. **公钥校验回调与内嵌位置**：
   - `.data` 段 `AvbOps`（`lk+0xe7978..0xe79d0`）绑定了 `validate_vbmeta_public_key`（`lk+0x9ace4`）与 `validate_public_key_for_partition`（`lk+0x9aa10`）。
   - 与 `vbmeta.img` 存储完整 1,032 B 结构体不同，`lk` **仅内嵌 512 B（4096-bit）大端 RSA 模数**（开头 `99 83 5c 83 ...`，结尾 `... 84 13 0c db`）；校验函数先检查输入 `AvbRSAPublicKeyHeader.key_num_bits == 0x1000`（4096 位），再跳过 8 B 头部对比 512 B 模数：
     - `lk_avb_key`（512 B）：`image\lk.img` 文件偏移 **`0xe7bd8`**（`lk` 载荷偏移 `0xe79d8`）；
     - `recovery` 公钥（512 B）：`image\lk.img` 文件偏移 **`0xe7960`**（`lk` 载荷偏移 `0xe7760`），两处逐字节完全相同。
   - *（区分：文件偏移 `0xe7648` 另有一把 256 B RSA-2048 密钥 `g_sec_oemkey`（`a3 d4 e3 d7 ... 34 19 a1 43`），供 MTK `cert1`/`cert2` 启动链 `sec_set_oemkey` 使用，并非 AVB 公钥。）*
4. **跨镜像验证**：由 `0xe7bd8` 处 512 B 模数与 $e = 65537$ 重建 1,032 B `AvbRSAPublicKey` 块（`num_bits = 4096`、`n0inv = 0xbc29f0ad`），计算得 SHA1 = **`8fcb864f11f53ed11284615fb67685522085d3a2`**。该 1,032 B 公钥块与 `vbmeta.img`（`SHA256_RSA4096`，且链式签名 `boot` RIL 3、`vbmeta_system` RIL 2、`vbmeta_vendor` RIL 4）、`vbmeta_system.img`、`vbmeta_vendor.img` 及 `boot.img` 中提取的公钥块**逐字节完全一致**。（若直接对裸 512 B 模数求 SHA1 会得到 `49eed893a32b0761fb146cfd316ef141be0bd39d`，不符合 AOSP `avbtool.py` 规范。）

### 7.4 跨版本对比：早期固件 `1.1.10.299` 的 `lk.img` AVB 公钥轮换

拆解目前公开互联网最早版本 `TB335FC_CN_OPEN_USER_M1317.3_V_ZUXOS_1.1.10.299_ST_250509.7z`（`build_time = 2025-05-09 21:08:56`，Android 15）中的 `image\lk.img`（2,912,192 B）及其 AVB 镜像后，可清晰还原出一次**完整的 AVB 密钥轮换（Key Rotation）**：

1. **`1.1.10.299` `lk.img` 内嵌 AVB 公钥提取与 SHA1**：
   - **`lk_avb_key`（主 `vbmeta` 公钥）**：位于 `lk.img` 文件偏移 **`0xe4f40`**（`lk` 载荷偏移 `0xe4d40`；`validate_vbmeta_public_key` @ `0x98e50` 检查 `cmp w8, #0x800` 并 `memcmp` `0x100` 字节），长度为 **256 B（RSA-2048）**，`n0inv = 0xc9d87d7b`。按 AOSP `avbtool.py` 算法编码为 520 B `AvbRSAPublicKey` 后：
     - **`Public key (sha1)`**：**`cdbb77177f731920bbe0a0f94f84d9038ae0617d`**（SHA-256：`22de3994532196f61c039e90260d78a93a4c57362c7e789be928036e80b77c8c`），**与 AOSP 公开测试密钥 `testkey_rsa2048.pem` 及 `1.1.10.299` `vbmeta.img`（`SHA256_RSA2048`）逐字节完全一致**（这也解释了为何 `1.5.10.321` 的 `boot-debug.img` 仍残留着 `testkey_rsa2048.pem` 签名）。
   - **`recovery` AVB 公钥**：位于 `lk.img` 文件偏移 **`0xe4dc8`**（`lk` 载荷偏移 `0xe4bc8`；`validate_public_key_for_partition` @ `0x98b7c`），同样为 **256 B（RSA-2048）**，`n0inv = 0xf5c50811`：
     - **`Public key (sha1)`**：**`0aa0987116fc792f36bc909b0a4d530413f02a54`**（SHA-256：`30ff3647a550f8cb83ddaa715e24acbd5e5014090daea0792147b8123b25b2a8`）。
   - **`1.1.10.299` 链式签名公钥（均为 `SHA256_RSA2048`）**：`boot.img`（RIL 3）为 `9d808b0995768d0677fccb1efcddb7cf9e153d99`，`vbmeta_system.img`（RIL 2）为 `fa41159a5d696abdef93176a07d0b0d001263f01`，`vbmeta_vendor.img`（RIL 4）为 `9577bc6c0772975ecce93c4d8a178662c728dadf`。
2. **密钥演化结论**：
   - 从 `1.1.10.299`（2025-05）到 `1.5.10.321`（2026-09），联想将 AVB 启动链全部签名密钥从分散的多把 RSA-2048 密钥（含主 `vbmeta` 上的 AOSP `testkey_rsa2048`）升级并统一为一把 OEM **RSA-4096** 正式密钥（`8fcb864f11f53ed11284615fb67685522085d3a2`）；而 MTK 平台 `cert1`/`cert2` 根密钥（`g_sec_oemkey` 与 `efuse.img` `524abce2...`）保持不变。
   - **刷机约束**：在锁定 Bootloader 的设备上，严禁混刷 `1.1.10.299` 与 `1.5.10.321` 的单个 `lk`、`vbmeta*` 或 `boot` 分区，必须整套配套刷入同一密钥代际的固件。

---

## 8. `boot-debug.img` 与 `vendor_boot-debug.img` 的调试功能、放宽限制及锁 BL 加载可行性

### 8.1 头部与二进制结构对比

| 字段 | `boot.img` | `boot-debug.img` | `vendor_boot.img` | `vendor_boot-debug.img` |
| --- | ---: | ---: | ---: | ---: |
| 文件大小 (B) | `67,108,864` | `67,108,864` | `67,108,864` | `28,581,888` |
| 魔数 / Header 版本 | `ANDROID!` / v4 | `ANDROID!` / v4 | `VNDRBOOT` / v4 | `VNDRBOOT` / v4 |
| 内核大小（LZ4 压缩） | `25,063,907` | `25,662,417` | — | — |
| Ramdisk 大小 | `0`（在 `init_boot.img`） | `0` | `28,120,281` | `28,378,709` |
| DTB / `cmdline` | — | — | `192,119` / `bootopt=64S3,32N2,64N2` | 一致（逐字节相同） |
| AVB 脚标与算法 | `AVBf` / `SHA256_RSA4096`（`8fcb864f...`） | `AVBf` / `SHA256_RSA2048`（`cdbb7717...`） | `AVBf` / `Algorithm: NONE`（`vbmeta` 校验哈希） | **无 AVB 脚标** |

### 8.2 可用于哪些调试功能、放宽了哪些限制

1. **`boot-debug.img`（内核级差异）**：二者 `ramdisk_size = 0`，因此 `boot-debug.img` 全部变化都在内核镜像。相比 `boot.img` 的 Google 通用 GKI 内核（`5.15.197-android13-8-00005-g2d8ad9139b89-ab15063902`），`boot-debug.img` 为 MTK/本地 ACK 调试内核（`5.15.197-android13-8-g4aae32e83325`），`IKCFG_ST` 配置共有 **980 项差异**：
   - **放宽模块与符号限制**：`CONFIG_TRIM_UNUSED_KSYMS=n`（导出完整内核符号表而非按 `abi_symbollist.raw` 裁剪，方便加载树外或调试用 `.ko` 驱动模块）、`CONFIG_MODULE_SIG_ALL=n`（切换为 `certs/mtk_signing_key.pem`，`CONFIG_MODULE_SIG_FORCE=n`）。
   - **开启芯片与驱动调试设施**：`CONFIG_ARCH_MEDIATEK=y`、`CONFIG_MTK_PRINTK=m`、`CONFIG_MTK_PRINTK_UART_CONSOLE=y`、`CONFIG_SERIAL_8250_MT6577=m`（串口控制台输出）、`CONFIG_MTK_AEE_IPANIC=m`（AEE 内核崩溃转储）、`CONFIG_MTK_BLOCK_IO_TRACER=m`、`CONFIG_MMSTAT_TRACER=m`、`CONFIG_DMABUF_HEAPS_DEBUG=m`、`CONFIG_MMC_DEBUG=m`、`CONFIG_MTK_APUSYS_DEBUG=y`、`CONFIG_MTK_THERMAL_TRACE=m`、`CONFIG_MICROTRUST_TZ_LOG=y`、`CONFIG_NL80211_TESTMODE=y` 等。
2. **`vendor_boot-debug.img`（用户态早期调试覆写）**：解压 LZ4 CPIO 后，原 `vendor_boot.img` 的 **726 个文件逐字节保持不变**，仅精准**新增 3 个文件**（合计 729 个条目）：
   - `force_debuggable`（0 B）：AOSP `first_stage_init` 识别的空哨兵文件；
   - `adb_debug.prop`（418 B）：以最高优先级覆写属性：`ro.adb.secure=0`（免 ADB RSA 主机弹窗确认）、`ro.debuggable=1`（允许 `adb root` 及全应用调试）、`ro.force.debuggable=1`；
   - `userdebug_plat_sepolicy.cil`（2,434,755 B，35,917 行）：`userdebug` 平台 SELinux 策略文件，包含 273 条 `adbd`/`su` 放宽规则（如 `(typepermissive su)` 和 `(allow adbd su (process (dyntransition)))`），让 `user` 正式版系统无需刷写 `system` 即可执行 `adb root`。

### 8.3 是否可在锁定 Bootloader 的设备上加载？

**结论：绝对不能。** 存在三重硬性拦截：

1. **AVB 验签必然失败（红屏拒启）**：
   - `vbmeta.img` 通过 Chain Partition 将 `boot` 的公钥固定为 `8fcb864f11f53ed11284615fb67685522085d3a2`；而 `boot-debug.img` 实测使用 **AOSP 公开测试密钥 `testkey_rsa2048.pem`**（`Public key (sha1): cdbb77177f731920bbe0a0f94f84d9038ae0617d`，与 `F:\GitHub\avbpowertool2\plugins\testkey_config_gen\keys\testkey_rsa2048.pem` 逐字节一致），与 `vbmeta.img` 及 `lk.img` 均不匹配。
   - `vbmeta.img` 对 `vendor_boot` 携带固定 SHA-256 Hash 描述符（摘要 `105e5692...`），而 `vendor_boot-debug.img` **甚至无 AVB 脚标**且内容哈希不匹配。
   - `lk.img` `load_vfy_boot` 仅在 `lock_state == 3`（`LKS_UNLOCK`）时才按 Orange State 放行验签失败镜像；锁机状态下会直接进入 Red State 拒绝引导。
2. **刷写接口拦截**：锁定状态下 Fastboot 拒绝 `flash:`/`erase:` 指令；即使经认证 DA 写入分区，开机仍过不了 `lk.img` AVB 校验。
3. **Android `init` 门禁**：`adb_debug.prop` 及 `first_stage_init` 自身亦限定仅在已解锁设备（`orange` 启动状态）下才加载 `/force_debuggable` 与 `userdebug_plat_sepolicy.cil`。

---

## 9. 为什么刷入该包后，原先解锁 Bootloader 的设备会锁定 Bootloader？

**根本原因**：一键脚本以 `firmware-upgrade`（`CMD:FLASH-UPDATE`）模式刷机，该模式仅备份恢复 scatter 中标记为 `PROTECTED`/`BINREGION` 的分区，而存放 Bootloader 锁状态的 `seccfg` 分区在 `MT6835_Android_scatter.xml` 中被标记为 `INVISIBLE`，导致 `DA_BR.bin` 在刷机过程中直接擦除了 `seccfg`；随后设备重启时 `lk.img` 读取到失效的 `seccfg`，按默认安全策略将其重新初始化为**锁定状态（`LKS_DEFAULT = 1`）**。

完整证据链如下：

1. **脚本强制启用 `firmware-upgrade`**：`运行我，刷机.cmd` 第 4 行调用 `tool\SPFlashToolV6.exe -f %~dp0image\flash.xml -c firmware-upgrade`，对应下发 `DA_BR.bin` 的 **`CMD:FLASH-UPDATE`** 升级协议。
2. **Scatter 分区保护策略**：检查 `image\MT6835_Android_scatter.xml`（EMMC/UFS 一致）：
   - **受保护分区**（`operation_type="PROTECTED"` 或 `"BINREGION"`）：仅 `frp`、`nvcfg`、`persist`、`protect1`、`protect2`、`proinfo`、`nvram`；
   - **`seccfg` 分区**（起始 `0x19800000`，大小 `0x800000`）：`operation_type="INVISIBLE"`、`is_download="false"`、`is_reserved="false"`（同为 `INVISIBLE` 的还有 `lenovolock` 等）。
3. **`DA_BR.bin` 擦除 `seccfg` 的执行过程**：在 `CMD:FLASH-UPDATE`（`FU_S0`~`FU_S3`）中，`get_protected_partitions` 仅在 `FU_S0`/`FU_S1` 备份 `PROTECTED`/`BINREGION` 分区，**不备份 `seccfg`**；在 `FU_S2` 重建 GPT 并**擦除所有非受保护分区**（`tool\log\SP_FT_V6_Dump_07-20-2022-19-50-58\...\device_0.log` 第 4379 行实录：`Erase [seccfg]`，第 4391 行随即记录 `[SEC_CFG] sec_get_seccfg ret=c002005a` 失效）；`FU_S3` 仅回写之前备份的受保护分区。
4. **`lk.img` 重置锁态逻辑**：
   - `lk.img` 将 `seccfg` 分区中的 60 B `SECCFG_V4` 结构（魔数 `0x4d4d4d4d` + 尾标 `0x45454545`，硬件 HACC 加密 + SHA-256 校验）作为 Bootloader 锁态唯一依据（`lock_state == 3` / `LKS_UNLOCK` 代表解锁）。
   - 刷机后首次启动，`sec_get_seccfg()`（`lk+0x903a0`）读取被擦空的 `seccfg` 校验失败，调用初始化函数（`lk+0x90290` / `0x90090`）**重新写入 `lock_state = 1`（`LKS_DEFAULT`，已锁定）的新 `SECCFG_V4` 结构**，从而完成自动回锁。
   - **排除干扰项**：`frp` 与 `proinfo` 均为 `PROTECTED` 被完整保留；`lenovoraw.img` 全零使 `csdk_cofig.flash_dis == 0`，不会触发 `lenovolock` 写入；RPMB 仅用于 `[Check_Region]` 区域校验，不决定此次回锁。

---

## 10. 是否可以修改 `flash.xml` 达到不擦除 `seccfg` 的目的？

### 10.1 结论

**仅修改 `flash.xml` 本身无法阻止擦除 `seccfg`**；但可以通过两种可行的改造路径在不擦除 `seccfg` 的前提下完成刷机：

1. **保持 `-c firmware-upgrade`，修改 `MT6835_Android_scatter.xml`（或让 `flash.xml` 的 `<scatter>` 指向修改版 scatter 文件）**；
2. **修改 `运行我，刷机.cmd` 中的刷机模式参数，将 `-c firmware-upgrade` 改为 `-c download`（仅下载模式）**。

### 10.2 二进制与配置机制分析

1. **为何单改 `flash.xml` 无效**：
   - `SPFlashToolV6.exe` 加载 `image\flash.xml` 时由 `FlashXMLParser::isValidXMLSchema` 调用 `Qt5XmlPatterns.dll` 对照同目录 `image\flash.xsd` 执行校验。`flash.xsd` 采用严格 `xs:sequence`，仅允许 `project`、`dagent`、`scatter`、`build_version`、`build_time`、`version`、`contact` 这 7 个固定元素，任何新增标签或属性都会立即报错中断。
   - `FlashXMLParser` 只读取 `<dagent>`（`DA_BR.bin`）、`<scatter>`（`MT6835_Android_scatter.xml`）及 `<contact>`，不包含任何擦除或分区保护指令。
2. **方案 A（改 scatter XML + 配合 `flash.xml` `<scatter>`）的原理验证**：
   - **Scatter 无签名限制**：`SPFlashToolV6.exe` 导入的 `imageChecker.dll` 仅在存在 `scatter_checksum.xml` 时才校验哈希（本包无此文件）；`flash.dll` 与 `DA_BR.bin`（`0x4002FC40`）直接解析 scatter XML，没有任何数字签名、HMAC 或完整性检查。
   - **`DA_BR.bin` 动态读取 `operation_type`**：反汇编 `image\DA_BR.bin` Stage 2（`MTK_DA_v6_2026-01-06 20:05:10`，加载基址 `0x40000000`）：
     - 属性映射表（`0x4005968C..0x40059708`）将 `PROTECTED` 与 `BINREGION` 映射为枚举值 `3`，将 `BOOTLOADERS`、`INVISIBLE`、`UPDATE` 映射为 `2`，`RESERVED` 映射为 `4`；
     - `get_protected_partitions`（`0x40030760`，关键指令 `0x40030818: cmp r0, #3`）**动态遍历** scatter 中所有 `operation_type == 3` 的分区加入保护列表，无任何硬编码分区名；
     - 在 `CMD:FLASH-UPDATE` 的 `FU_S2` 阶段（`0x40005DA8..0x40006008`），DA 对位于保护列表且布局未变的分区直接跳过擦除（若 GPT 发生变动则于 `FU_S1` 备份并在 `FU_S3` 回写）。
   - **改法**：将 `MT6835_Android_scatter.xml` 中 `seccfg` 的 `<operation_type>INVISIBLE</operation_type>` 改为 `PROTECTED`（同理可用于 `lenovolock`），即可在 `-c firmware-upgrade` 下保留 `seccfg`（`tool\log\SP_FT_V6_Dump_07-21-2022-11-49-10\...\device_0.log` 第 81235 行亦证实原因 `INVISIBLE` 而执行 `Erase [seccfg] At[0x17800000] Len[0x800000]`）。
3. **方案 B（将 `-c firmware-upgrade` 改为 `-c download`）**：
   - `-c download` 对应向 DA 发送 `CMD:WRITE-PARTITIONS`（`DA_BR.bin` `cmd_write_partitions` `0x40002B20..0x40003260`）。
   - 该命令首先调用 `compare_scatter_file`（`0x40002B44 -> 0x40030468`）：只要设备当前 GPT 布局与 scatter 一致（`r0 == 0`），就只刷写 `<flash_list>` 中 `is_download="true"` 的 26 个分区项，**完全不碰 `is_download="false"` 的 `seccfg`**。仅当 GPT 分区表发生变化（报错 `"GPT layout change. FW upgrade or Format all first."`）、BROM/DA 认证失败或未解锁状态刷入未签名镜像时才会失败。
4. **锁状态策略补充**：`DA_BR.bin` 的 `sec_get_seccfg`（`0x40038A58`）在 `get_sec_policy`（`0x40030C80`）读取 `g_sec_policy`（`0x4005BF40`），全表所有条目的 `dl_forbidden` 标志位（`0x04`）均为 `0`，两种模式下都不会因设备已解锁或已锁定而拒绝保留 `seccfg`。

---

## 11. `lk` 是否带防回滚保护？

### 11.1 结论

**是，`lk` 双向均编译并启用了基于硬件 eFuse OTP 的防回滚（Anti-Rollback, ARB）保护；但结合最早公开版 `1.1.10.299`（2025-05-09）与当前很晚近（且可能是最终版）的 `1.5.10.321`（2026-09-08）实测对比，联想在整个生命周期内从未调高任何一项防回滚版本号——`MTK cert1/cert2` 始终为 `2`、`AVB rollback_index` 始终为 `0`。** 因此，刷入或启动 `1.5.10.321` **不会**熔断新的 eFuse 位而锁死向 `1.1.10.299` 等早期官方固件的降级通道。

### 11.2 双向 ARB 机制拆解

1. **针对 `lk.img` 自身的防回滚（由 Preloader 与 `bl2_ext` 执行）**：
   - `image\lk.img` 内全部 5 个子镜像（`lk`、`bl2_ext`、`aee`、`lk_main_dtb`、`lk_dtbo`）的 `cert1`/`cert2` 中 OID `2.16.886.2454.2.2`（`key_ver`/`cnt_ver`）均为 **`2`**（`2.16.886.2454.2.9 = 0`，`2.16.886.2454.2.5 = 0` 或 `1`）；`preloader_sycamore_prc_consumer_wifi.bin` 自身签名尾标（`0x60184..0x607f0`）同样为 `key_ver = 2`（`0x605b2`）、`cnt_ver = 2`（`0x606c6`）。
   - **Preloader（加载基址 `0x02000f10`）**：在 `0x02025fc8 -> 0x02030030`（`load_part_cert_vfy_start`）查找 `g_policy_map[2]`（`"lk"`，偏移 `0x0205f764`）。当 SBC 开启且 Bootloader 锁定（`lock_state != 3`）时，`img_auth_required = 1`，执行 `cert_chain_vfy`（`0x0204039c`）与 `sec_ver_check(0)`（`0x0204386c`，强制 `verk == verc && verk >= otp[0]`），并在 `0x02031f4c -> 0x02036c94 -> 0x020439e4`（`sec_update_tf_version`）将更高版本熔断写入硬件 eFuse `OTP[0]`（上限 31，否则报错 `"[SEC] ARB Fail (0x%x)"`）；当处于解锁状态（`lock_state == 3`）时，`img_auth_required = 0`，跳过 `lk` 证书与 ARB 检查。
   - **`bl2_ext`（`lk.img` 内部，加载基址 `0xffff000062f00000`）**：加载校验 `lk`/`atf`/`tee`/`sspm`/`spmfw` 时，若开启校验则在 `0x04a798 -> 0x019164 -> 0x0599b8/0x059a80`（`sec_arb_check`）对照 `ar_table`（`0x0fcf70`）校验版本。
2. **`lk.img` 对下游镜像实施的防回滚（`lk` 加载基址 `0xffff000050f00000`）**：
   - **AVB Rollback Index（非空桩实现）**：`AvbOps.read_rollback_index`（`lk+0x09adf8`）通过 `0x02b290 -> 0x08a64c`（`get_avb_otp_ver`）读取硬件 eFuse OTP **Group 2**（`OTP[3..4]`，最多 64 位）或 **Group 3**（`OTP[5..6]`，`rollback_index_location == 1`）。`write_rollback_index`（`0x09ae70`）之所以返回 `0`（`mov w0, wzr; ret`），是因为 OTP 烧录被延迟到 `boot_linux_fdt`（`0x0105e0 -> 0x02b3f0`）：在确认当前 A/B 槽位 `boot_successful` 后，遍历 `ar_table`（`0x0e6f68`，Groups 1–3）调用 `0x08adb8`（`update_otp_ver`）及 `0x03e4e4`（`sec_efuse_write`，操作 MMIO `0x11c10810..0x11c1082c` 与 `0x11c10430`）永久熔断 eFuse，并置位 `EFUSE_OTA_Protect`。
   - **MTK 镜像 ARB**：`sec_img_auth`（`0x078e24 -> 0x02b204 -> 0x08ab84 sec_arb_check(1, NULL)`）按 Group 1（`OTP[1..2]`）校验 `2.16.886.2454.2.2`（`key_ver == cnt_ver >= otp_ver`），另通过 `0x08a7c0` / `0xe7598` 处理 Group 4 子表。
3. **全生命周期（`1.1.10.299` vs `1.5.10.321`）防回滚实测对比与降级结论**：
   - 原先仅看 `1.5.10.321` 时，容易误以为其 `2` / `0` 只是尚未升级的早期基线；结合公开最早固件 `TB335FC_CN_OPEN_USER_M1317.3_V_ZUXOS_1.1.10.299_ST_250509.7z`（Android 15）与当前很新（甚至可能是最终版）的 `1.5.10.321`（Android 16）交叉比对，结果完全一致：

| 检查项 | 最早公开版 `1.1.10.299`（`2025-05-09`） | 晚期/现行版 `1.5.10.321`（`2026-09-08`） | 变化情况 |
| --- | --- | --- | --- |
| `preloader_sycamore_prc_consumer_wifi.bin` | `key_ver = 2`, `cnt_ver = 2`（GFH sig `0x5febc`） | `key_ver = 2`, `cnt_ver = 2`（GFH sig `0x60184`） | **未变** |
| `lk.img` 全 5 个子镜像 `2.16.886.2454.2.2` | 全部 **`2`**（`cert1` & `cert2`） | 全部 **`2`**（`cert1` & `cert2`） | **未变** |
| 其余 11 个已签名 MTK 镜像 `2.16.886.2454.2.2` | 全部 **`2`**（`tee`/`gz`/`logo`/`scp`/`vcp`/`sspm`/`dpm`/`mcupm`/`pi_img`/`spmfw`/`connsys_bt`） | 全部 **`2`** | **未变** |
| `lk` / `bl2_ext` `ar_table`（144 B，5 组） | `lk@0xe43d0`, `bl2_ext@0x8a4b0` | `lk@0xe6f68`, `bl2_ext@0xfcf70` | **逐字节相同** |
| `vbmeta*.img`、`boot.img`、`dtbo`/`init_boot`/`vendor_boot` | `rollback_index = 0` | `rollback_index = 0` | **未变** |
| `efuse.img`（512 B） | SHA-256 `524abce23f56a536...` | SHA-256 `524abce23f56a536...` | **逐字节相同** |

- **结论纠正**：`1.5.10.321` 并没有利用设备内部活跃的 eFuse ARB 机制封锁降级；**从最早版 `1.1.10.299` 到最新/末期版 `1.5.10.321`，联想始终将 MTK 版本冻结在 `2`、AVB 版本冻结在 `0`**（仅当未来万一再推出把版本升至 `> 2` 或 AVB `> 0` 的更新时才会熔断新 eFuse 位；其与密钥轮换之间的安全闭环关系详见第 15 节）。但锁机降级时仍需注意第 7.4 节指出的 **AVB 密钥轮换**（`RSA-2048` vs `RSA-4096`），必须整套刷入同一版本包的引导与 AVB 分区，不可混刷单个镜像。
- **配套一键检测工具**：同目录下已附带 [check_arb.py](file:///d:/TB335FC_ZUXOS_1.5.10.321_Tool/check_arb.py) 与 [一键检测防回滚索引.cmd](file:///d:/TB335FC_ZUXOS_1.5.10.321_Tool/一键检测防回滚索引.cmd)，支持直接检测本包、单个 `lk.img`/`.img`、`.7z` 归档及双版本横向对比。

---

## 12. 是否可以修改 `logo.img` 实现更美观的开机画面和解锁提示？

### 12.1 结论

- **开机画面、充电/模式/区域提示等屏幕图像**：**可以**，但**仅限 Bootloader 已解锁（`LKS_UNLOCK`，`lock_state == 3`）的设备**；锁定设备上任何篡改均会校验失败。
- **解锁提示（“Orange State” 警告文本）**：**无法通过修改 `logo.img` 实现**，因为该提示完全硬编码在 `lk.img` 二进制代码与内置点阵字库中。

### 12.2 `image\logo.img` 内部结构

- `image\logo.img`（6,370,160 B）包含 MKIMG Part #0 `logo`（`6,365,858` B）及 `cert1`/`cert2`（`mtk_unsigned_images\logo.img` 载荷与其逐字节一致）。
- 载荷头部记录条目数 `count = 121`、`total_size = 6,365,858`，后接 121 个 `uint32` 偏移与独立 `zlib` 压缩流；显示规格为竖屏 **`1600 × 2560`**、**32bpp BGRA8888**（单张全屏图解压为 `16,384,000` B，横屏界面在图像内预旋转 90°；`lk` `calculate_logo_offset` `0x99530` 支持条目数 `{103, 121, 150}` 及 32bpp/16bpp）：
  - `[0]`：由 `bl2_ext`（`mt_disp_show_boot_logo` `0x4aae0`）加载的开机第一屏（红色 `Lenovo` + `Powered by Android`）；
  - `[1..98]`、`[103..120]`：关机充电背景、进度动画、大小号数字 `0`–`9` 与 `%`、电池故障警示；
  - `[99]`：`==> FASTBOOT MODE`；`[100]`：模式选择菜单；`[101]`：`==> META MODE`；`[102]`：区域硬件不兼容白屏提示（`[Check_Region]` 失败时调用）。
  - *（另注：`bl2_ext` `0x4ad50` 与 `lk` `0x791e4` 会检查 `lenovoraw` 偏移 `0x11` 的 `custLogo_enable` 标志，若为 `1` 则改从 `lenovoraw+0x2000` 加载定制画面；本包 `lenovoraw.img` 为全零故默认使用 `logo_a`。）*

### 12.3 解锁提示（Orange State）的绘制原理

反汇编 `lk.img` `load_vfy_boot` -> `show_warning()`（`lk+0x04e89c`）证实，当 `g_boot_state == 2`（Orange State）时（`0x04e8f8..0x04e948`）：

1. 调用 `0x3c7a0`（`video_clean_screen`）对整个 `1600×2560` 帧缓冲执行清零涂黑（直接覆盖掉此前 `bl2_ext` 显示的 `logo.img[0]`）；
2. 调用 `0x3c758`（`video_set_cursor(rows/2, 0)`）将光标定位到第 80 行第 0 列；
3. 调用 `0x3c694`（`video_printf`）配合 `lk` 内置 `8×16` 点阵字库（`0x0c25f8`）直接绘制硬编码字符串 `"Orange State\n\n"`（`0x0af499`）与 `"OS Not Being Verified Or Custom OS. Dismiss After 5 Seconds.\n"`（`0x0b8765`）；
4. 延时 `0x4c4b40`（`5,000,000` µs = 5 秒）后直接继续引导 Linux 内核，**全程不读取 `logo.img`，也不会重新绘制 `logo.img[0]`**。因此修改/美化解锁提示只能修补 `lk.img`。

### 12.4 签名验证与刷写通道

- `logo` 不受 AVB `vbmeta` 验证管控，完全由 `bl2_ext`（`0x0fd000`）与 `lk`（`0x0e6ff8`）的 `g_policy_map[3]`（`['logo', 'logo_a', 'logo_b']`）决定：
  - **锁定 Bootloader（`lock_state != 3`）**：`sec_sbcen_lock_policy = 1`（`img_auth_required = 1`），`bl2_ext` 与 `lk` 强制验证 `cert1`/`cert2` 与 ARB，修改版无合法私钥签名会被拒绝加载，且 Fastboot `flash:` 被禁止；
  - **已解锁 Bootloader（`lock_state == 3`）**：`sec_sbcen_unlock_policy = 2`（`img_auth_required = 0`），`bl2_ext` 与 `lk` **完全跳过 `cert1`/`cert2`、ARB 与头校验**；可直接通过 `fastboot flash logo_a custom_logo.img`（≤ 16 MiB，符合 MKIMG 头 + 121 条目表即可，无需签名；若切换槽位需同步刷 `logo_b`）生效。

---

## 13. 可以删去包中的哪些文件以便缩减分发大小？

全包原始规模：**192 个文件，11,558,770,040 字节（11,023.3021 MiB / 10.7649 GiB）**（含 `image\` 68 文件 `10,943,985,642` B、`tool\` 122 文件 `614,783,824` B、根目录 2 文件 `574` B）。结合 `SPFlashToolV6.exe` 的 PE 静态导入表与 `main()`（`0x46A502`）反汇编，全部文件按删减安全性分为三类：

### 13.1 A 类：100% 安全可删（完全不影响一键脚本与本包 GUI 刷机）

**共 144 个文件，可缩减 `2,097,611,243` B（`2,000.4380 MiB` / `1.9536 GiB`，占原包 `18.147%`）**：

1. **`image\` 中已被 `super.img` 收纳的散落逻辑镜像、`*.map` 与 `super_empty.img`**（12 文件，`1,378,355,114` B / `1,314.5019 MiB`）：`system_ext.img`、`system_ext.map`、`vendor.img`、`vendor.map`、`system_other.img`、`vendor_dlkm.img`、`vendor_dlkm.map`、`system_dlkm.img`、`system_dlkm.map`、`odm_dlkm.img`、`odm_dlkm.map`、`super_empty.img`；
2. **`tool\log\`**（94 文件，`498,062,991` B / `474.9899 MiB`）：2022 年工程师测试日志残留；
3. **`image\` Debug 镜像**（2 文件，`95,690,752` B / `91.2578 MiB`）：`boot-debug.img`、`vendor_boot-debug.img`；
4. **`tool\BackupData\`**（5 文件，`87,032,976` B / `83.0011 MiB`）：2022 年 `tulip` 设备残留备份；
5. **`image\mtk_unsigned_images\`**（13 文件，`25,006,912` B / `23.8484 MiB`）：未签名构建备份目录；
6. **`image\` 条带拆分镜像**（2 文件，`9,712,216` B / `9.2623 MiB`）：`userdata_stripe_0.img`、`userdata_stripe_1.img`；
7. **`tool\Readback\`**（2 文件，`2,097,152` B / `2.0000 MiB`）：残留回读文件 `ROM_0`、`ROM_1`；
8. **`image\download_agent\`**（4 文件，`856,857` B / `0.8172 MiB`）：与 `image\` 根目录逐字节重复的 4 个文件；
9. **`image\` 工厂数据库、清单与旧版 txt scatter**（5 文件，`477,922` B / `0.4558 MiB`）：`APDB_MT6835___W2440`、`APDB_MT6835___W2440_ENUM`、`installed-files-ramdisk.txt`、`installed-files-vendor.txt`、`MT6835_Android_scatter.txt`；
10. **`tool\` 无用历史/配置/Schema 与未引用 SSL 库**（5 文件，`318,351` B / `0.3036 MiB`）：`ssleay32.dll`（311,370 B，PE 及 `Qt5Network.dll` 均未导入）、`readback_ui_bak.xsd`、`history.ini`、`write_efuse.xml`、`read_efuse.xml`。

> 仅删 A 类后剩余 **48 个文件，9,461,158,797 B（9,022.8641 MiB / 8.8114 GiB）**。

### 13.2 B 类：谨慎 / 视场景可删（共 5 文件，`1,365,488` B / `1.3022 MiB`）

- `tool\plugins\platforms\qwindows.dll`（1,221,752 B）：`运行我，刷机.cmd` 使用命令行 `QCoreApplication` 不加载它；但删除后直接双击 `SPFlashToolV6.exe` 打开 GUI 会报错退出。
- `tool\plugins\styles\qwindowsvistastyle.dll`（128,632 B）：仅 GUI 原生外观插件，删后 GUI 退回默认样式，CLI 不用。
- `tool\console_mode.xsd`（12,226 B）：仅在使用 `-i <config.xml>` 模式时调用，`-f ... -c firmware-upgrade` 不加载。
- `image\da.auth`（2,272 B）：工具不会自动加载且 `.cmd` 未传 `-a`，仅当个别熔断 DAA 设备报 `Need AUTH file` 时需要手动指定，建议保留。
- `tool\option.ini`（606 B）：**强烈建议保留**。反汇编 `0x46EC30` 发现只有 `LogPath` 检查了 `QSettings::contains()`，其余多数配置项缺失时 `readBool`/`readInt` 会把默认值覆写为 `false`/`-1`（例如 `BaudRate=-1`、`Battery=-1`、`DAChksum=-1`、`StorageLifeCycleCheck=false`）并在退出时写回。

### 13.3 C 类：绝对必须保留（最小可刷机集合：43 文件，`9,459,793,309` B / `8.8101 GiB`）

- **根目录（2 文件，574 B）**：`运行我，刷机.cmd`（331 B）、`notice.txt`（243 B，`.cmd` 第 3 行重定向依赖，除非同步删改 `.cmd`）。
- **`image\`（29 文件，9,433,883,597 B / 8.7860 GiB）**：
  - 入口与控制（4）：`flash.xml`、`flash.xsd`、`DA_BR.bin`、`MT6835_Android_scatter.xml`；
  - Scatter 指定的 25 个刷机镜像：`preloader_sycamore_prc_consumer_wifi.bin`、`vbmeta.img`、`vbmeta_system.img`、`vbmeta_vendor.img`、`spmfw.img`、`pi_img.img`、`dpm.img`、`scp.img`、`vcp.img`、`sspm.img`、`mcupm.img`、`gz.img`、`lk.img`、`boot.img`、`vendor_boot.img`、`init_boot.img`、`dtbo.img`、`tee.img`、`connsys_bt.img`、`efuse.img`、`logo.img`、`super.img`、`lenovoraw.img`、`lenovocust.img`、`userdata.img`。
- **`tool\`（12 文件，25,909,138 B / 24.7088 MiB）**：`SPFlashToolV6.exe` 以及 Windows PE 加载器在命令行模式下亦强制校验的 11 个静态导入 DLL（`flash.dll`、`imageChecker.dll`、`SLA_Challenge.dll`、`libeay32.dll`、`Qt5Core.dll`、`Qt5Gui.dll`、`Qt5Widgets.dll`、`Qt5XmlPatterns.dll`、`Qt5Network.dll`、`Qt5Xml.dll`、`Qt5SerialPort.dll`）。

### 13.4 压缩分发补充建议

必需镜像中仍含大量 4 KiB 全零填充块：`lenovocust.img` 300.00 MiB 中含 **299.79 MiB（99.9%）** 全零、`lenovoraw.img` **16.00 MiB（100%）** 全零、`boot.img` 含 **40.07 MiB** 全零、`vendor_boot.img` 含 **36.98 MiB** 全零、`dtbo.img` 含 **7.74 MiB** 全零、`init_boot.img` 含 **5.04 MiB** 全零。删除 A 类后直接采用 7z / zstd 压缩归档，无需修改任何镜像文件即可将上述超过 405 MiB 的全零区及未压缩数据体积大幅压低。

---

## 14. `libavb` 密钥容忍度、分区间密钥隔离与非链式分区转链式分区

### 14.1 `libavb` 是否按分区指定唯一密钥对（分区间隔离与密钥容忍度）

**结论：是按分区精准绑定唯一公钥，而不是“只要公钥在 Fastboot/LK 内置公钥集合中就一律承认”。**

反汇编 `image\lk.img` 中 `load_and_verify_vbmeta()`（`lk+0x95490..0x95548`）可见，其完整保留了 AOSP `avb_slot_verify.c` 的三条互斥验签分支，严格隔离不同分区的公钥信任边界：

1. **链式子分区（`boot`、`vbmeta_system`、`vbmeta_vendor` 等）——仅认父级 `vbmeta` 指定的唯一公钥，不查 Bootloader 内置公钥**：
   - 当校验链式子分区时，`expected_public_key` 参数非空（`0x95490: ldr x0, [x29, #0x68]`），`libavb` 直接在内部将该分区 `AVB0` 头携带的公钥与父级 `vbmeta` 中对应 `AvbChainPartitionDescriptor` 写死的 `public_key` 做逐字节 `avb_safe_memcmp`（`0x954ac`），**根本不调用** `AvbOps` 中的任何公钥回调。
   - 即使签名所用的密钥对应公钥恰巧内置在 `lk.img` 里，只要与父级链式描述符中的唯一公钥不逐字节一致，同样直接报错 `": Public key used to sign data does not match key in chain partition descriptor."`。
   - **实证**：`1.1.10.299` 中 `boot`（`9d808b09...`）、`vbmeta_system`（`fa41159a...`）、`vbmeta_vendor`（`9577bc6c...`）三把链式公钥**全部不存在于 `lk.img` 内部**，完全仅靠 `vbmeta.img` 的 `Chain Partition` 描述符按分区名逐一指定；反之，用 `lk.img` 内置的 `lk_avb_key` 去签 `1.1.10.299` 的 `boot.img` 必然验签失败。
2. **顶层 `vbmeta` 分区——仅调用 `ops->validate_vbmeta_public_key`**：
   - 顶层 `vbmeta` 无父级 `expected_public_key`（`0x95494: cbz x0, 0x954fc`），因此路由至 `ops->validate_vbmeta_public_key`（`lk321:0x9ace4` / `lk299:0x98e50`）。
   - 本机 `lk.img` 未实现多公钥池，也未编译 `avb_custom_key`（用户自定义黄屏密钥）：函数仅校验密钥位数（`1.5.10.321` 为 `0x1000`=4096 bit，`1.1.10.299` 为 `0x800`=2048 bit）并仅与唯一一把硬编码 `lk_avb_key`（`lk321+0xe79d8` / `lk299+0xe4d40`）做 `memcmp`。
3. **脱离 `vbmeta` 独立校验的分区（`AVB_SLOT_VERIFY_FLAGS_NO_VBMETA_PARTITION`）——按分区名路由至 `ops->validate_public_key_for_partition`**：
   - 反汇编 `lk321:0x9aa10`（`lk299:0x98b7c`）可见，该函数显式比对 `partition_name` 前 8 字节是否为 `"recovery"`（`0x797265766f636572`）：**只要不是 `"recovery"`，直接返回 `3`（`AVB_IO_RESULT_ERROR_NO_SUCH_PARTITION`）拒签**；仅 `"recovery"` 才与唯一的 recovery 硬编码公钥（`lk321+0xe7760` / `lk299+0xe4bc8`）做 `memcmp`。
   - **实证**：`1.1.10.299` 中 `lk_avb_key`（`cdbb7717...`）与 recovery 公钥（`0aa09871...`）虽然同在 `lk.img` 内部，但按回调入口与分区名严格隔离，互不可混用（`1.5.10.321` 只是巧合把两处填成同一把 OEM RSA-4096 公钥 `8fcb864f...`，分区隔离的代码逻辑并未改变）。
4. **普通非链式分区（`dtbo`、`init_boot`、`vendor_boot`、`system`、`vendor`、`product`、`system_ext`、`*_dlkm`）**：
   - 直接由上级 `vbmeta` / `vbmeta_system` / `vbmeta_vendor` 中的 `Hash` / `Hashtree` 描述符锁定摘要（自身 `Algorithm: NONE`），不单独进行非对称公钥验签。

### 14.2 是否允许为非链式分区添加签名哈希页脚后加入链式分区集合？

**结论：允许，只要目标是一个物理 GPT 分区且同时满足 `libavb` 与 `vbmeta` 信任链的 6 项结构约束，即可通过校验。**

`libavb` 并未按分区名称限制“谁能成为链式分区”（本机 `boot.img` 本身就是“自带签名 Hash Footer + 顶层 `vbmeta` 链式引用”的范例）。但实测本机 `lk.img` 反汇编确认，必须满足以下全部条件：

1. **仅限物理 GPT 分区，不可直接用于 `super` 内的逻辑分区**：`lk.img` 的 `AvbOps.read_from_partition` 仅按 GPT 读取物理分区（如 `boot`、`vendor_boot`、`init_boot`、`dtbo`），不解析 `super` 内 LP 动态分区元数据，因此 `system`、`vendor`、`product`、`system_ext`、`*_dlkm` 无法直接作为顶层链式分区，必须仍经由物理 `vbmeta_system` / `vbmeta_vendor` 间接校验。
2. **必须同步重编并用主根私钥重签顶层 `vbmeta.img`**：仅修改目标分区页脚会导致与顶层 `vbmeta.img` 中保留的旧 `Hash` 描述符摘要冲突而失败。必须在顶层 `vbmeta.img` 中删除该分区原 `Hash` 描述符，改为写入对应 `AvbChainPartitionDescriptor`（绑定分区名、新公钥和 `rollback_index_location`），并用 `lk` 信任的主根私钥重签顶层 `vbmeta.img`（新链式分区本身可使用独立密钥对和任意合法 AVB 算法）。
3. **仅允许一级链式引用，禁止嵌套链**：本机 `lk.img`（`lk+0x95bd0`）保留 `": Encountered chain descriptor not in main image."` 校验，`Chain Partition` 描述符只允许出现在顶层 `vbmeta` 中，禁止放在 `vbmeta_system` 等子级 `vbmeta` 内。
4. **`rollback_index_location`（RIL）与 `vbmeta` 总数约束**：
   - `Chain Partition` 描述符中的 `rollback_index_location` 必须满足 **`1 <= RIL < 32`**（`lk+0x95ab4: cmp w8, #0x20`，不通过则报 `": Chain partition has invalid rollback_index_location field."`），且应避开已被占用的 `0..4`（从 `5` 起分配；实测 `lk321` 的 `read_rollback_index @ 0x9adf8` 对 `2..31` 均读 Group 2 OTP 返回 `OK`）；
   - 整个信任链中的 `vbmeta` 镜像总数（顶层 + 全部链式分区）不得超过 **`32`** 个（`lk+0x956ac: cmp x22, #0x20` -> `": Too many vbmeta images."`）。
5. **链式分区自身的格式与尺寸要求**：分区末尾 64 B `AVBf` 页脚指向的内部 `AVB0` 头必须满足 `flags == 0`（`lk+0x953b8` 报错 `": chained vbmeta image has non-zero flags"`）、头内 `rollback_index_location == 0`、`Hash` 描述符 `partition_name` 与分区名匹配，且总体积不超过物理分区大小。
6. **对加载阶段无副作用**：`load_vfy_boot` 调用 `avb_slot_verify` 后，统一从 `AvbSlotVerifyData.loaded_partitions` 按分区名取回通过校验的镜像载荷，不关心其 `Hash` 描述符原本在顶层 `vbmeta` 还是在分区自身的链式页脚中。

---

## 15. 早期版本 `testkey` 信任根安全缺陷、密钥轮换动因与防回滚闭环评估

1. **早期版本 `testkey` 作为 AVB 信任根的安全含义**：
   - 在 AVB 2.0 树状信任链中，**顶层 `vbmeta` 对应的密钥对是整条验证启动链的唯一信任根（Root of Trust）**。`lk.img` 只负责核查顶层 `vbmeta` 的签名是否匹配其内嵌的 `lk_avb_key`，而各子分区究竟信任哪一把公钥、校验哪一个哈希摘要以及是否启用校验标志，全部由顶层 `vbmeta` 内部的描述符决定。
   - 如第 7.4 节所述，早期官方正式包 `1.1.10.299`（`user/release-keys`）在 `lk.img` 与顶层 `vbmeta.img` 上使用了私钥公开的 AOSP 默认测试密钥 `testkey_rsa2048.pem`。虽然其 `boot`、`vbmeta_system`、`vbmeta_vendor` 子分区各自使用了独立的私有密钥，但一旦任何方使用公开的 `testkey_rsa2048` 私钥重新签发顶层 `vbmeta.img`，即可改写其中的链式公钥或哈希描述符，从而在信任链逻辑上架空子分区厂商私钥对整机启动完整性的保护（同时违反 Android 量产 `release-keys` 签名安全规范）。
2. **密钥轮换的直接动因**：
   - 这正是联想在后续固件（如 `1.5.10.321`）中将 `lk.img` 与整个 AVB 启动链全部轮换并统一为厂商自主保密的 OEM RSA-4096 密钥对（`8fcb864f11f53ed11284615fb67685522085d3a2`）的根本原因——通过消除公开信任根私钥，在新版固件自身重建完整的不可伪造信任链。
3. **密钥轮换与防回滚之间的闭环缺口**：
   - 在严格的安全工程实践中，信任根密钥轮换通常需要同时执行两步：**（一）换用新根公钥**，以及 **（二）同步递增引导程序防回滚版本号并熔断 eFuse**，以硬件方式吊销带有旧信任根的早期签名引导程序。
   - 结合第 11 节的全生命周期取证可见，TB335FC 在 `1.5.10.321` 中**完成了第（一）步（轮换了 AVB 公钥），但并未执行第（二）步**——`preloader` 与 `lk.img`（包括 `bl2_ext`）的 MTK 防回滚版本全程停留在 `2`，AVB `rollback_index` 全程停留在 `0`，平台根公钥 `g_sec_oemkey` 亦保持未变。因此在实际防御上，已锁定 Bootloader 的设备主要依靠刷写接口权限控制（锁定状态禁止 Fastboot 刷机、线刷底层需要受权验证的 DA/认证文件）来防止非授权回退至早期版本的 `lk.img`。
