---
output: word_document
---

# avbtool.py 使用说明

> [!important]
> 如果您没有操作命令行工具的经验，本篇教程可能并不适合你。
>
> 照道理来讲，添加 `-h` 旗标查看命令帮助比查看本教程更高效。因此本教程只提供最基本的信息和一些简单的示例。

`avbtool.py` 是 Google 为 Linux 环境设计的一个和构建工具链集成的 Python 工具，用于为生成的镜像文件添加 `VBMeta` 元数据格式，利用 AVB2.0 提供对设备镜像的保护。

要在 Linux 环境下使用 avbtool ，需要安装 OpenSSL ，并将配套工具 `fec` （用于生成前向纠错数据）和它的动态链接库放置到系统 `path` 中。

要在 Windows 环境下使用 avbtool ，需要安装 OpenSSL 并确保它位于 `path` 中。如果还是无法调用，请考虑更改源代码以调用特定硬编码位置的 OpenSSL 。Windows 环境下无法提供可用的 FEC 工具，因此无法生成包含哈希树描述符的 VBMeta 元数据结构，这会导致验证失败。因此如果要生成完整 ROM 的 AVB 信息，请优先考虑使用 Linux 。

> [!note] 关于 OpenSSL 和 fec 两大依赖
> OpenSSL 负责解析密钥对，例如 `testkey_rsa4096.pem` ，命令 `add_hash_footer` 和 `extract_public_key` 需要此工具。
>
> `fec` 是 Google 私有的 Linux 二进制程序，用来生成特定的前向纠错编码，为 `add_hashtree_footer` 命令提供支持。目前暂时没有移植到包括 arm Android, x86-64 Windows, Windows on Arm 等平台的方案。

下面讨论的命令都基于 Linux 环境，对于 Windows 环境，您的命令开头应为 `python avbtool.py` 或者 `py avbtool.py` 。

在开始之前，为了方便，请先 `chmod +x avbtool.py` 。这么做能够使用 `./avbtool.py` 代替 `python3 avbtool.py` 来调用脚本。

查看帮助： `./avbtool.py -h`

```text
    generate_test_image
                        生成带有测试格式的镜像，测试格式: 0x00 0x01 0x02 ... 0xff 0x00 0x01 ...
    version             打印 avbtool 的版本.
    extract_public_key  从 .pem 文件中提取公钥.
    extract_public_key_digest
                        从 .pem 文件中提取公钥，并返回公钥的 SHA-256 摘要.
    make_vbmeta_image   创建 vbmeta 镜像.
    add_hash_footer     向镜像添加哈希数据和 AVB 页脚.
    append_vbmeta_image
                        将 vbmeta 镜像附加到镜像中.
    add_hashtree_footer
                        向镜像添加哈希树和 AVB 页脚.
    erase_footer        从镜像中擦除页脚信息.
    zero_hashtree       用二进制数码 0 覆盖哈希树和前向纠错数据.
    extract_vbmeta_image
                        从镜像中提取带页脚的 vbmeta 镜像.
    resize_image        设定镜像大小，会保留页脚信息.
    info_image          显示 vbmeta 镜像或 AVB 页脚包含的信息.
    verify_image        验证镜像.
    print_partition_digests
                        打印分区的摘要.
    calculate_vbmeta_digest
                        计算 vbmeta 的摘要.
    calculate_kernel_cmdline
                        计算内核命令行.
    set_ab_metadata     设定 A/B 插槽的元数据.
    make_certificate (make_atx_certificate)
                        创建 "avb_cert extension" 证书.
    make_cert_permanent_attributes (make_atx_permanent_attributes)
                        创建 "avb_cert extension" ，带永久属性.
    make_cert_metadata (make_atx_metadata)
                        创建 "avb_cert extension" 元数据.
    make_cert_unlock_credential (make_atx_unlock_credential)
                        创建 "avb_cert extension" 解锁凭据.
```

上面所有的命令都支持 -h 参数。例如 `./avbtool.py add_hash_footer -h` ，这会显示这个命令支持的所有参数。

我们主要使用命令 `add_hash_footer` `add_hashtree_footer` `erase_footer` `info_image` 和 `make_vbmeta_image`

1. info_image
   
   `用法： ./avbtool.py info_image --image <your_image>`
   
   打印给定镜像的 AVB 信息。如果镜像没有 VBMeta 元数据结构将给出提示。
2. erase_footer
   
   `用法： ./avbtool.py erase_footer --image <your_image>`
   
   擦除给定镜像的 VBMeta 元数据结构。
3. add_hash_footer
   
   添加 Hash 描述符到指定镜像，看看下面的例子：
   
   ```shell
   ./avbtool.py add_hash_footer --image boot.img\
   --partition_name boot\
   --paritition_size 102760448 # 单位是字节\
   --algorithm SHA256_RSA4096
   --key ./testkey_rsa4096.pem
   --salt <填写一个盐，可能是原镜像使用的盐>\
   --rollback_index <重要，填写正确的回滚指数，严禁填写 9999999999 等无意义数值，这个数值会被存储在防篡改存储中，不要随意尝试！>\
   --prop <属性的名称>:<属性的值> # 可以有很多条
   ```
4. add_hashtree_footer （依赖 FEC ，仅限 Linux 可以创建被 AVB 信任的镜像）
   
   添加 Hashtree 描述符，看看下面的例子：
   
   ```shell
   ./avbtool.py add_hashtree_footer --image system.img\
   --hash_algorithm SHA256\
   --salt <填写一个盐>\
   --partition_name system\
   --prop <属性的名称>:<属性的值> # 可以有很多条
   # --do_not_generate_fec 对于 Windows 平台临时测试很有用
   ```
5. make_vbmeta_image
   
   生成单独的 vbmeta 镜像，看看下面的例子：
   
   ```shell
   ./avbtool.py make_vbmeta_image --output ./my_vbmeta.img\
   --algorithm SHA256_RSA4096\
   --key testkey_rsa4096.pem\
   --rollback_index <也是一样，不确定数值是多少就不要乱填>\
   --chain_partition boot:2:testkey_rsa4096.bin # 链式分区描述符，格式：分区名:回滚指数在非可篡改存储中的下标:密钥，密钥需要使用 extract_public_key 命令从 .pem 文件中提取，可以有多个链式分区\
   --include_descriptors_from_image vendor_boot # 包含其他镜像的信息，可以有多个
   ```

   > [!note] vbmeta 的属性字符串
   > `vbmeta` 内包含的属性字符串一般直接来自其“包含描述符”的镜像，所以通常不需要添加参数 `--prop` 。
   > 某一键签名工具使用 `--include_descriptors_from_image vbmeta.img --include_descriptors_from_image init_boot.img` 来更新存储在 `vbmeta` 数据结构中的 `init_boot` 分区数据。这么做可以通过 AVB 验证，但是会向 `vbmeta` 中再添加一次来自 `init_boot` 的属性字符串。对于部分边界状况，这是个需要特别关注的问题。