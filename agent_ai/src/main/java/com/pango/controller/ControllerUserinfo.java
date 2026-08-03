package com.pango.controller;

import com.pango.entity.DtoUserinfo;
import com.pango.rs.R;
import com.pango.service.ServiceUserinfo;
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

}
