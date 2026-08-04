package com.pango.controller;

import com.pango.entity.DtoUserinfo;
import com.pango.rs.R;
import com.pango.exception.MyException;
import com.pango.service.ServiceUserinfo;
import com.pango.service.ServiceAuth;
import com.pango.utils.MyAssert;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import java.util.Map;

/**
 * 用户信息控制入口
 */
@RestController
@RequestMapping("/userinfo")
public class ControllerUserinfo implements MyAssert {

    @Resource
    private ServiceUserinfo serviceUserinfo;
    @Resource
    private ServiceAuth serviceAuth;

    /**
     * 修改用户信息
     * @param obj DtoUserinfo
     */
    @PostMapping("/doUpdate")
    public R doUpdate(@RequestBody DtoUserinfo obj){
        strIsNull(obj.getWxCode(), "微信号");
        strIsNull(obj.getNickName(), "昵称");
        DtoUserinfo userInfo = serviceUserinfo.doUpdate(obj);
        return R.ok(userInfo);
    }

    /**
     * 根据微信号获取用户信息
     * @param params 参数
     */
    @PostMapping("/getByWxCode")
    public R getByWxCode(@RequestBody Map<String, Object> params){
        String wxCode = strIsNull(params.get("wxCode"), "微信号");
        DtoUserinfo userinfo = serviceUserinfo.getByWxCode(wxCode);
        return R.ok(userinfo);
    }

    @PostMapping("/guest")
    public R guest(@RequestBody Map<String, Object> params) {
        String guestKey = strIsNull(params.get("guestKey"), "访客标识").trim();
        String platform = strIsNull(params.get("platform"), "访问平台").trim().toLowerCase();
        if (!guestKey.matches("^[A-Za-z0-9_-]{8,100}$")) throw new MyException("访客标识格式不正确");
        if (!"web".equals(platform) && !"miniprogram".equals(platform)) throw new MyException("访问平台不正确");
        DtoUserinfo guest = serviceUserinfo.getOrCreateGuest(guestKey, platform);
        ServiceAuth.AuthResult session = serviceAuth.createSession(guest);
        guest.setAccessToken(session.getToken());
        return R.ok(guest);
    }

}
