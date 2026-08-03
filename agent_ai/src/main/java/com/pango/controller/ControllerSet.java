package com.pango.controller;

import com.pango.entity.DtoSet;
import com.pango.rs.R;
import com.pango.service.ServiceSet;
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
@RequestMapping("/set")
public class ControllerSet implements MyAssert {

    @Resource
    private ServiceSet serviceSet;

    /**
     * 变更用户使用权限
     * @param params 参数
     */
    @PostMapping("/upFlagUseData")
    public R upFlagUseData(@RequestBody Map<String, Object> params){
        int id = idIsNull(params.get("id"), "ID");
        int flagUseData = intIsNull(params.get("flagUseData"), "使用数据权限");
        DtoSet set = serviceSet.doUpdateFlagUseData(new DtoSet().setId((long) id).setDataUseFlag(flagUseData));
        return R.ok(set);
    }

}
