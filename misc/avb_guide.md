---
output: word_document
---

# AVB (Android Verified Boot) 入门

> [!warning] 免责声明 DISCLAIMER
> 本文是本人对 AVB 机制的理解，不是包括但不限于“正确答案”、“参考答案”、“Google 的理解”的任意一个。
>
> 如果有任何错漏，欢迎您的指出和 PR。

> [!note]
> 如果对 AVB 功能和 vbmeta 的具体实现有兴趣，请访问 [Google Source](https://android.googlesource.com/platform/external/avb/+/main/README.md) 获取官方说明文档。

Android 启动时验证是为 Android 设备提供启动时保护的功能，在 Android BootLoader (abl) 实现。它能够保证设备上的分区合法可信，并提供回滚保护。本文从（进阶）终端用户的角度解释设备启动时的验证流程，帮助理解 avbtool 签名的意义。

我们下面讨论的 AVB 验证特指基于 `vbmeta` 数据结构实现的镜像可信验证。事实上， AVB 2.0 还包含 AVB 1.0 开始就具备的一些特性，例如 `dm-verity` 。这部分信息在这里不做深入讨论，但是对于实际场景，为了保证 `dm-verity` 等 *完整性验证* （锁定 Bootloader 时同样无法关闭）不发生异常，必须生成 `Hashtree` 信息和配套的 `FEC` 数据。

如果你只想知道设备启动流程而不关心 `vbmeta` 结构中包含的数据项，可以直接跳转到 [启动流程](./avb_guide.md#启动流程) 一节。

## 约定

1. 下文所讲的分区都说的是使用 AVB 进行保护的分区
2. 哈希（Hash）:生成唯一定长特征字符串，每个特征字符串对应唯一的文件
3. 哈希树（Hash Tree）：用于大型分区（如 system），将数据分块构建树状哈希，支持按需验证，配合 dm-verity 实现运行时完整性检查。
4. 前向纠错（FEC）：与哈希树配合，可恢复部分损坏的数据，提高可靠性。
5. 回滚保护（Rollback Protection）：每个分区维护一个单调递增的“回滚指数”，设备用 `RPMB` 持久化存储已启动过的最大指数，并拒绝启动回滚指数低于最大指数的镜像。这么做可以防止攻击者刷入旧版本镜像绕过漏洞修复。
6. vbmeta 结构：一个特殊的 vbmeta 分区包含来自其他分区的多个描述符（哈希描述符、哈希树描述符、链式描述符），描述符中存储了各分区的验证信息，vbmeta 自身用公钥签名保证完整性。

## 数据项

根据分区类型的不同，一个分区镜像内的 VBMeta 元数据必须包含下面的项目（还有很多没有写，下面写出的是在进行签名操作时必须提供的信息）：

**Hash 分区：**

1. 分区名称：例如 `boot`
2. 分区大小：以字节为单位的一个数字，例如 102760448
3. 签名算法：默认为 `SHA256_RSA4096`
4. 公钥摘要：用于验证公钥的完整性。当镜像携带公钥时，设备计算其摘要并与存储的摘要对比，防止攻击者替换公钥
5. 回滚指数：标记“版本号”，刷入过高回滚指数的镜像的设备不能刷入低回滚指数的镜像，否则将被拒绝启动
6. 盐：用于防止预计算攻击（如彩虹表），使得即使相同的数据在不同上下文中产生不同的哈希值，增加破解难度
7. 属性：各种属性字符串，例如安全补丁级别

**Hashtree 分区：**

1. 哈希算法：指定创建摘要时使用的哈希算法，多为 `sha256`
2. 分区名称：例如 `init_boot`
3. 分区大小：以字节为单位的一个数字，例如 8388608
4. 回滚指数：标记“版本号”，刷入过高回滚指数的镜像的设备不能刷入低回滚指数的镜像，否则将被拒绝启动
5. 盐：用于防止预计算攻击（如彩虹表），使得即使相同的数据在不同上下文中产生不同的哈希值，增加破解难度
6. 属性：各种属性字符串，例如安全补丁级别
7. FEC数据：前向纠错信息。

**vbmeta 分区（名字中包含 vbmeta 的分区，这些分区都是 Hash 分区）：**

1. 签名算法：默认为 `SHA256_RSA4096`
2. 链式分区信息：指向其他链式分区，并记载这些分区的下列信息：
   - 链式分区的名字
   - “回滚指数位置”
   - 公钥的 SHA1 摘要
   - 链式分区的标识 (Flags)
3. 哈希分区信息：指向使用哈希信息进行验证的分区，并记载这些分区的下列信息：
   - 镜像大小
   - 哈希算法名称
   - 分区名称
   - 所使用的盐
   - 镜像摘要
   - 标识 (Flags)
4. 哈希树分区信息：指向使用哈希树信息进行验证的分区，并记载这些分区的下列信息：
   - dm-verity 版本
   - 镜像大小
   - 哈希树大小、偏移量等信息（帮助找到哈希树）
   - 前向纠错信息
   - 哈希算法名称
   - 分区名称
   - 所使用的盐
   - 根摘要信息
   - 标识 (Flags)
5. 属性：来自所包含哈希和哈希树分区镜像的属性信息
6. vbmeta 本身的可信凭据：公钥摘要、算法、回滚指数、标识等，和 Hash 分区大同小异

## 启动流程

验证顺序是这样的：

> abl -> vbmeta 分区 -> vbmeta 分区中包含的其他分区信息，包括链式分区、Hash 分区和 Hashtree 信息。
>
> 流程中除了基于 vbmeta 的 *篡改保护* ，还同步进行基于 `dm-verity` 和 `哈希树` 的 *完整性验证* （这部分不是本文讨论的重点）。两者中任意一环出错都会导致启动中止。

启动时，`BootLoader` 会先验证 `vbmeta` 分区。此分区用于记载其他受保护分区的信息，包含两个重要数据段：

1. vbmeta 分区自身的可信凭据，包括 vbmeta 分区的密钥、摘要信息和回滚指数
2. vbmeta 分区内包含的其他分区信息，BootLoader 会根据 vbmeta 内记载的这些信息查找设备内对应的分区，检查并计算分区数据，将计算结果和记载结果核对，完成对其他受保护分区的验证

如果 vbmeta 本身验证失败（例如使用攻击者生成的，和设备内烧录密钥信息不一致的密钥进行了签名操作），设备会直接拒绝启动。vbmeta 分区内包含的其他分区信息如果和 BootLoader 计算结果不一致也会被拒绝启动。

这个过程有点像*一棵树*：vbmeta 是树根和主干，主干上长出若干子分区信息作为树枝，树枝又可以分成若干小树枝（vbmeta 可以指向 vbmeta_system 等同样包含其他分区信息的分区，这个过程可以无限重复）。

就用小新 Pad Pro GT 为例子：

> [!note] TB710FU 简明启动验证顺序
> 1. vbmeta
> 2. 发现 vbmeta 包含其他分区的信息
> 3. 检查其中包含的分区的完整性：boot, recovery, vbmeta_system, dtbo, init_boot, vendor_boot, odm, system_dlkm, vendor, vendor_dlkm
> 4. 发现 vbmeta_system 包含其他分区的信息
> 5. 检查 vbmeta_system 包含的分区的完整性：pvmfw, system, system_ext
>
> 分区信息均无误 -> 核准启动
>
> 存在验证失败的分区 -> 拒绝启动

具体验证则按照下面的步骤进行：

1. 系统先验证 vbmeta 镜像，发现 vbmeta 使用正确的公钥（SHA1 摘要 2597c218aae470a130f61162feaae70afd97f011） 进行签名，使用烧录的公钥根据给定算法进行核对，结果正常，镜像可信。
2. 验证 vbmeta 回滚指数，发现回滚指数为 0 ，不小于系统内持久化存储中记载的 vbmeta 分区回滚指数，接受此镜像。
3. 查找 vbmeta 内的各个分区信息，发现有如下若干分区，记录对应的关键信息准备核对：
   - 链式： boot, recovery, vbmeta_system
   - 哈希： dtbo, init_boot, vendor_boot
   - 哈希树： odm, system_dlkm, vendor, vendor_dlkm

4. 分别用类似方法验证上面的分区是否同样可信：跳转到对应分区，获取对应分区的 vbmeta 元数据，先和 vbmeta 中记载的信息做对照，以 boot 和 vbmeta_system 为例：
   
   | vbmeta 中记载的      | boot 分区中包含的    |
   |----------------------|----------------------|
   | 分区名字 boot        | 分区名字 boot        |
   | 公钥摘要 2597...f011 | 公钥摘要 2597...f011 |
    
    发现信息完全吻合，镜像可信。

    对于 vbmeta_system 分区，我们发现这也是一个 vbmeta 分区，其中包含了下面分区的信息：
       
    - 哈希： pvmfw
    - 哈希树： product, system, system_ext

    那么除了验证 vbmeta_system 分区本身可信之外，还要进一步验证其中包含的四个分区的可信性。
5. 重复此过程（检查签名、检查回滚指数、检查信息和 vbmeta 中的记载是否匹配）直到所有分区都被验证，如果均无问题则 AVB 流程结束，核准启动高阶操作系统。
6. 如果上述步骤中任何一步出现问题，验证流程即刻终止，BootLoader 向用户提示出错信息，同时停止启动流程：
   
   “原版 BootLoader” 会显示下面的信息：
   
   > Your device is corrupted. It can not be trusted and will not boot.

   小米 / OPlus 有各自自定义的校验失败画面。

## 总结分析

1. 如果分区信息包含在 vbmeta 类别的镜像中且为 Hash 或者 Hashtree 分区，那么修改这个分区就要同步生成新的 vbmeta 镜像：
    
    ∵ 修改分区

    ∴ 分区摘要变化

    ∵ vbmeta 中包含了分区摘要

    又∵ 分区摘要和 vbmeta 中不一致会导致启动错误

    又∵ 希望系统正常启动

    ∴ 必须生成新的 vbmeta 镜像

    这就解释了 LKM 模式需要同时签名修改的分区并重新生成对应 vbmeta 的原因。

2. 如果分区信息包含在 vbmeta 类分区中，但是是链式分区，那么更改镜像后不需要重新生成 vbmeta 镜像，但是需要重新对本镜像使用 vbmeta 中记录的公钥进行签名：
    
    ∵ 镜像被修改

    ∴ 镜像摘要值变化

    ∵ vbmeta 中只记载“回滚指数位置”和公钥摘要，不记载镜像摘要值

    ∴ 不需要重新生成 vbmeta

    ∵ vbmeta 中记载了本分区

    ∴ BootLoader 会校验此分区

    ∴ 必须为本分区重新签名，并使用之前的密钥

3. 某个分区刻意没有包含在 vbmeta 中
   
   默认 AVB 行为不会验证它。但由于 ROM 中定义的其他启动验证和 `dm-verity` 的存在，启动过程仍旧会失败。例如为 TB710FU 移植 HyperOS 时，必须为 mi_ext 分区添加 Hashtree 页脚并将这个分区的描述符信息包含在 vbmeta_system 中。

4. 为什么 ROMer 总要关闭 AVB 验证？
   
   ROMer 可以为自己制作的 ROM 重新使用新的密钥对进行签名，但是此密钥对用于签名的公钥和设备内烧录的私钥不符，因此就算签名了镜像，设备也不会承认这是有效镜像，拒绝启动。因此，不得不关闭 AVB 验证以保证系统能够启动。除非厂商有意或无意暴露了签名用的公钥，这样就可以使用厂商公钥签名并正常启动操作系统。

5. 解锁 BootLoader 和 AVB 验证状态的关联
   
   锁定的 BootLoader 会强制启用 AVB，解锁状态下则不会。因此在回锁 BootLoader 时要非常注意，不要尝试在刷写了第三方镜像或者修改镜像的设备上锁定它。

   在 Android 系统中查询 AVB 状态会有三种情况：
   - Green: AVB 启用，使用厂商提供的密钥对保护设备。
   - Yellow: AVB 启用，使用用户烧录的密钥对保护设备。
   - Orange: AVB 禁用，不会执行任何程度的启动保护，表明 BootLoader 已解锁。
  
   在 Yellow 和 Orange 状态下启动设备时会有相关提示，平时常见的是解锁 BootLoader 后出现的 Orange State 提示：

   > Orange State
   >
   > Your device has been unlocked and can not be trusted.
   >
   > Your device will boot in 5 seconds.

6. 用户自定义密钥
   
   在 Pixel 2 和 Pixel 2 XL 及更新的 Pixel 设备上支持烧录用户自定义密钥对。使用自定义公钥签名的系统镜像可以在烧录自定义私钥的设备上正常启动。此时 AVB 状态为 Yellow ，表明正在使用自定义密钥对保护设备，启动时，屏幕上会提示关于 Yellow State 的提示。

7. 厂商应对措施
   
   通过更新构建系统的密钥对，并在系统更新中包含加载新的私钥的 `abl` + 使用新的公钥签名的镜像组合，可以有效封堵漏洞。为了防止攻击者通过降级 `abl` 重新利用漏洞，可以进一步更新前向启动链(xbl)。

8. 一点练习，某台紫光芯片的设备
   
   - Footers in vbmeta -> Type "Chain": boot, dtbo, socko, odmko, **vbmeta_system**, **vbmeta_system_ext**, **vbmeta_vendor**, **vbmeta_product**, *nr_modem*, *nr_phy*, l_agdsp, pm_sys
   - Footers in vbmeta_system -> Type "Hashtree": system
   - Footers in vbmeta_system_ext -> Type "Hashtree": system_ext
   - Footers in vbmeta_vendor -> Type "Hashtree": vendor
   - Footers in vbmeta_product -> Type "Hashtree": product

   该设备为大量分区配置了 AVB 2.0 启动时验证，除去常规的 HLOS 分区外，还对 5G 基带固件 *（斜体）* 也进行了相关保护。这一点导致基带也无法被随意篡改。

   该设备的信任根 vbmeta 只包含链式分区描述符，连接到若干子 vbmeta 镜像和 boot 等分区。其中 vbmeta 镜像群中，每个子 vbmeta 针对一个分区进行保护，包含了该分区的描述符。

   对于不同的镜像使用了不同密钥进行签名，算法均为 `SHA256_RSA4096` ，密钥主要有三组，对于 vbmeta 群使用的是同一个密钥。对于哈希树分区使用 SHA1 进行摘要。

   由于使用链式分区进行保护，生成 `vbmeta` 时使用的命令的旗标为 `--chain_partition partition_name:rollback_index_location:public_key_binary`。因此无法在缺失一个或多个密钥的情况下劫持启动链，是安全性较高但是较为复杂的方式。

9. ./magiskboot sign
    
    这条命令为目标镜像添加 AVB1.0 页脚。根据参数，它似乎没法为镜像添加 AVB 2.0 的数据段。