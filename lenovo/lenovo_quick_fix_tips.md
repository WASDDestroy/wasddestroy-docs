# 联想平板自助刷机工具 - 小妙招

联想平板自助刷机工具（Lenovo Quick Fix），就是[此网页](https://newsupport.lenovo.com.cn/commonProblemsDetail.html?noteid=424556)提供的工具：

![](./media/lenovo/lenovo-quick-fix-tips/download_page.png)

这个工具正常情况下能自动完成刷机，但是部分用户反映这个软件无法识别 9008 设备：

![](./media/lenovo/lenovo-quick-fix-tips/no_device_detected.png)

虽然我非常怀疑这是由于设备未处于 9008 模式，也就是按照下图方法（**关机**后按音量上插线）进入的模式：

![](./media/lenovo/lenovo-quick-fix-tips/connect_device.png)

因此推荐先按照 [常见问题解答](./tb710fu-doc/faq.md) 中的提示再检查一次你的步骤，或者使用常见问题解答中提供的其他方法强制进入 9008。

如果还是没有成功识别设备，可以将刷机包从软件加载的外部目录 `C:\LenovoQuickFix\QuickFixTabletBrushTool\Brush` 中复制出来：

![](./media/lenovo/lenovo-quick-fix-tips/dir_c.png)

![](./media/lenovo/lenovo-quick-fix-tips/dir_lenovo_quick_fix.png)

![](./media/lenovo/lenovo-quick-fix-tips/dir_quick_fix_tablet_brush_tool.png)

![](./media/lenovo/lenovo-quick-fix-tips/dir_brush.png)

![](./media/lenovo/lenovo-quick-fix-tips/dir_final.png)

复制出的刷机包结构和你从子站点 [TB710FU 资源下载](./tb710fu-doc/resource_download.md) 页面找到的官方包一致，而且没有密码。

因此你现在可以让平板进入 9008 模式，用设备管理器确认 9008 端口号，然后打开 `运行我，刷机.bat` 输入端口号回车刷机。

利用这个系统包救砖的教程可以参考 [救砖](./tb710fu-doc/unbrick_device.md) 的官方包一节。