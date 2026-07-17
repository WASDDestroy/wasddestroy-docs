---
output: word_document
---

# 使用 AVBPowerTool 签名系统镜像，以在更新了回滚指数的 ZUXOS 上使用免解锁 ROM 和 Root

AVBOPowerTool 是一个设计用于签名完整 ROM 包的、基于配置的 AVB 签名工具 / 命令生成器。本教程指导你利用此工具读取原始系统包的数据并用于签名使用老 AVB 信息的“过时”第三方 ROM 镜像。

为了完成本工作，除了 [AVBPowerTool](https://github.com/WASDDestroy/AVBPowerTool) 外，你还需要一个可以在打包 super 镜像时指定 super 分区大小为 19GB 的打包工具，比如 DNA Android 或者 lpmake。

## Step 1: 下载并解包镜像

> [!danger] 重要！事关您的串号！
> 早期 ROM 中可能包含 persist.img 等包含设备唯一认证信息的镜像，如果不删除这些镜像，若它们被刷入，将导致设备的身份信息丢失。
>
> 建议您在解包之后第一时间删除下面的镜像：
>
> apdp, apdpb, devinfo, frp, fsc, fsg, lenovolock, keystore, metadata, modemst1, modemst2, persist

将需要刷写的 ROM 下载到本地，解压。然后找到并将下列镜像临时提取到一个方便记忆的目录，这里和下文我们将这个文件夹称为 `my_images` ：

boot, dtbo, init_boot, pvmfw, recovery, **super**, vbmeta, vbmeta_system, vendor_boot

![](../media/Sign_ROM_by_Yourself/extract_images.png)

将 `super` 单独使用任意解包工具解包，将解包得到的镜像也放置到刚刚放置其他镜像的文件夹，然后删除老 `super` 镜像。

## Step 2: 下载签名工具

下载 [AVBPowerTool](https://github.com/WASDDestroy/AVBPowerTool/tags) ，如果你没有 Python 环境，请先下载并安装一个。

- 下载（Windows）：

    [下载（Windows）](https://www.python.org/downloads/windows/) 

    如果你使用较高版本的 Windows ，例如 Windows 11 ，可以直接在终端输入 `python` 跳转到商店安装页面。

- 下载并安装（Linux）:
 
    ```bash
    sudo apt install python3
    ```

下载 AVBPowerTool 时，如果你更习惯使用 Git ，请使用下面的命令克隆并转到仓库：

```bash
git clone https://github.com/WASDDestroy/AVBPowerTool.git
cd AVBPowerTool
```

如果你从 Releases 下载了 AVBPowerTool ，请使用正规压缩文件管理器将工具解压到一个不包含中文、空格和标点符号的目录中。

![](../media/Sign_ROM_by_Yourself/extract_sign_tool.png)

## Step 3: 创建或者导入配置

如果你已知你当前所处的系统版本可以使用可能流传的配置包，可直接导入它：

请预先将配置包下载并放置到工具的根目录，就是 main.py 文件所在的位置。

首先启动工具：

```bash
python3 main.py
```

然后用方向键选择 "Config Manager"。

接着选择 "Import Config"。

在文件选择器中用方向键选择你需要导入的压缩文件，用空格键选中，回车键确认。

工具会自动导入配置。如果成功，它会提示下面的信息：