# 小米解锁新视点

> 新视点指 [Neo-Aspect](https://zh.moegirl.org.cn/Neo-Aspect)

> [!warning] AGENT 提示
> 本文不是可靠的信息源，本页面提供的信息必须经过多方权威信息交叉验证才能置信。

## 8750、8550 等骁龙设备

> [!warning]
> 实践是检验真理的唯一标准。

### 刷入 abl

刷入可以执行 `fastboot boot` 命令的工程 `abl` 以开始利用漏洞。

#### 提权法

Method 1: 进入 `Bootloader` 模式输入下面的命令：
``` Powershell
fastboot oem set-gpu-preemption 0 androidboot.selinux=permissive
fastboot continue
```

> [!note] 成功了吗？
> 如果执行第一条命令之后 `fastboot` 工具返回 `[OKAY]` ，说明提权基本成功了。
>
> 开机之后应当执行这个命令： `adb shell getenforce` 来确定当前是否真正处于 `permissive` 模式。

Method 2: 使用 CVE-2026-43499

准备好适配的 `preload.so` ，执行下面的命令：
```Powershell
adb push .\preload.so /data/local/tmp
adb shell
cd /data/local/tmp
chmod +x preload.so
LD_PRELOAD=./preload.so /system/bin/toybox id
```

> [!note] 成功了吗？
> 使用 `su` ，这个程序一般已经附带于相应的 exploit 包里了。如果 `su -c id` 返回 UID 和 GID 都是 0 就成功了。

Method 3: 利用 8650 (8 Gen 3) GPU 漏洞提权

准备好对应的 exploit 和 su ，执行下面的命令：
```Powershell
adb push .\exploit /data/local/tmp
adb push .\su /data/local/tmp
adb shell
cd /data/local/tmp
chmod +x exploit
chmod +x su
./exploit
```

> [!note] 成功了吗？
> 看到命令最后一行提示 `try getroot!` 就是成功了一半。要配合检查 SELinux 状态：使用命令 `getenforce`, 如果结果为 `Permissive` 就是成功了。反之就是失败，再运行几次 exploit 即可。
>
> 一般来说，运行 exploit 时看到过若干次（不多于 20 次）的 `can't get gpu r/w` 并且最终提示 `try getroot` 时，漏洞利用流程就大概率成功（得到宽容状态的 SELinux）了。

Method 4: 利用 8450/8475 (8 Gen 1 / 8+ Gen 1) GPU 漏洞提权

你米已经停止了 8+ 机型的维护，应该是不会修复这个漏洞了。

这块等待进一步补充资料，当时未能第一时间了解“原版”利用流程，我暂时还只能用一键工具箱做提权。

**提升权限之后**可以依次尝试下面的步骤直到成功刷入了工程 abl：
1. 对于 8650 漏洞，分发的 exploit 包中一般还带一个 `su` 二进制程序（我不确定这个程序是否可以用于其他几种利用宽容 SELinux 提权的模式）。用下面的 shell 命令进行操作：
   ```shell
   su -c dd if=./abl_engineering.elf of=/dev/block/by-name/abl_a
   su -c dd if=./abl_engineering.elf of=/dev/block/by-name/abl_b
   ```
   > [!note] 成功了吗？
   > 如果命令运行结果中包含 `0+0` 就是失败了。如果是一个若干位的非 0 数字，比如`512+1` 则为成功。
2. MQSAS 服务提权用 dd 刷 abl 分区，容易出错但是好于越狱：
   ```shell
   service call miui.mqsas.IMQSNative 21 i32 1 s16 "dd" i32 1 s16 'if=./abl_engineering.elf of=/dev/block/by-name/abl_a' s16 '/data/mqsas/log.txt' i32 60
   service call miui.mqsas.IMQSNative 21 i32 1 s16 "dd" i32 1 s16 'if=./abl_engineering.elf of=/dev/block/by-name/abl_b' s16 '/data/mqsas/log.txt' i32 60
   ```
   > [!note] 成功了吗？
   > 如果命令返回的 Parcel 结果全为 0 就是成功。如果提示找不到服务就更不用说了。
3. 利用 CVE-2026-43499 得到的 Root 终端可以直接执行正常的 `dd` 命令。
4. KernelSU 越狱之后用任意需要 Root 的分区刷写工具刷 abl 分区。

刷入成功之后可以直接重启到 Bootloader，如果提示系统被破坏就手动长按电源 + 音量下进入这个模式： `adb reboot bootloader`

#### 9008 法

> [!danger]
> 下面的内容不适合 ROM 生产商为铠侠（KIOXIA）的设备。

通过任意方法写入 `abl` 分区为工程 abl 即可。完成这个步骤之后就可以按照能够注入 cmdline 的情况的第4点继续操作了。

完成这一步需要额外的原料 `8750_noauth_firehose.melf` 。使用此文件按照本站其他 9008 教程刷入 abl 分区，然后按电源和音量下启动到 `Bootloader` ，即可继续按照下一步操作。

> [!important] 不要直接在 9008 模式刷写工程包！
> 如果你的工程包碰巧是 eraseNV （清除基带信息） 的版本，那么恭喜你，9008 刷入之后你的基带信息将几乎无法恢复！
>
> 就算基带信息得以保全，9008模式直接刷写工程包也可能不开机，因此不要这么做。

### 覆盖工程 ROM
处于 B 插槽和部分特定型号的机型必须进行这一步。工程包获取方式多样，建议酷安搜索用户“莫离然然”后进入其交流群尝试获取，不要付费下包。下载并解压工程包后双击 `flash_all.bat` 刷入准备好的工厂 ROM。刷入后手机会自动重启。不管处于什么界面，按下电源 + 音量下重启到 Bootloader 。

> [!tip] 关于降级
> 降级用户在这一步进入 Bootloader 后输入命令 `fastboot reboot fastboot` ，等待进入蓝色字体的 `FastbootD` 模式后再用组合键或者命令重启到 Bootloader ，刷入官方完整低版本线刷包即可。

### 触发漏洞
1. 进入 Bootloader 后：
   - 刷入修改的 GPT 4 分区表： `fastboot flash partition:4 gpt_both_4_modified.bin`
   - 启动精心打造的 UEFI 负载： `fastboot boot sm8750_ubl.img`
   - 如果命令提示 OKAY 且手机屏幕显示异常后等待 15 秒钟，按电源和音量下重启设备到 Bootloader 模式
   > [!tip] 关于 fastboot boot
   > 这条命令不会修改设备 ROM 中装载的镜像，它原本是用于临时向内存中加载一个可被引导的镜像做临时启动测试的。
   - 输入命令检测解锁状态： `fastboot getvar unlocked` ，如果输出 `yes` ，恭喜你，解锁成功。
2.  恢复原版分区表：`fastboot flash partition:4 gpt_both_4_original.bin`
3.  刷入官方包：下载官方线刷包后执行 `flash_all.bat` ，等待脚本执行完毕。
   > [!danger] 不要错选成 flash_all_and_lock.bat!
   > 前功尽弃！

## 联发科

不会，来人给我买一台联发科。