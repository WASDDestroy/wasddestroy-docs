# 关于"前端攻击绕过登录"的说法

> 关联关键词：免登录提交、前端绕过、passport.lenovo.com

部分用户认为通过攻击解锁申请页面的前端 JavaScript，可以绕过联想账号登录直接提交解锁申请，从而绕开每日限额。为此，我们对解锁申请页面的前端 JS（来自 `www.zui.com/iunlock`）进行了分析。

## 登录机制

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

## UID 获取流程

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

## 验证码获取

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

## 解锁申请提交

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

## 为什么前端攻击无法绕过登录

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

## API 端点一览

| 端点 | 方法 | 作用 |
|------|------|------|
| `GET /unlock` | 获取 `uid`（基于当前登录会话） |
| `GET /unlock/getcode` | 获取图形验证码（需 `uid`） |
| `POST /unlock/add` | 提交解锁申请（需 `token` + `uid`） |

## 小结

- **登录是硬性前提**：没有有效的联想账号登录，就无法获得 `SCK` 会话令牌，也就无法通过服务端验证
- **前端不可信原则**：即使修改前端 JS 或直接构造 HTTP 请求，缺少 `SCK` 的服务端校验必然失败
- **账户关联追溯**：解锁申请与联想账号绑定，官方可追溯到申请者