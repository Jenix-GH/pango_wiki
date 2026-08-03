package com.pango.controller;

import com.pango.entity.DtoAnswer;
import com.pango.rs.R;
import com.pango.service.ServiceAnswer;
import com.pango.utils.MyAssert;
import com.pango.utils.UtilsValue;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import javax.annotation.Resource;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 回答控制入口
 */
@RestController
@RequestMapping("/answer")
@Slf4j
public class ControllerAnswer implements MyAssert {

    @Resource
    private ServiceAnswer serviceAnswer;

    /**
     * 添加回答
     * @param obj DtoAnswer
     */
    @PostMapping("/doAdd")
    public R doAdd(@RequestBody DtoAnswer obj){
        int userinfoId = idIsNull(obj.getUserinfoId(), "用户ID");
        serviceAnswer.doAdd(obj);
        // 强制终止服务端的流式接口
        AtomicBoolean cancelFlag =  UtilsValue.streamFlags.get(userinfoId);
        if (cancelFlag != null && cancelFlag.get()) {
            UtilsValue.streamFlags.put(userinfoId, new AtomicBoolean(false));
        }
        return R.ok();
    }

    /**
     * 评价
     * @param obj DtoAnswer
     */
    @PostMapping("/doEvaluate")
    public R doEvaluate(@RequestBody DtoAnswer obj){
        int userinfoId = intIsNull(obj.getUserinfoId(), "用户ID");
        int evaluate = intIsNull(obj.getFlagEvaluate(), "评价值");
        String answerTime = strIsNull(obj.getAnswerTime(), "回答时间");
        serviceAnswer.doEvaluate(Math.toIntExact(userinfoId), answerTime, evaluate);
        return R.ok();
    }

    /**
     * 获取回答记录
     * @param params DtoAnswer
     */
    @PostMapping("/getByQuestionId")
    public R getByQuestionId(@RequestBody Map<String, Object> params){
        int questionId = idIsNull(params.get("questionId"), "问题ID");
        int userinfoId = idIsNull(params.get("userinfoId"), "用户ID");
        DtoAnswer rs = serviceAnswer.getByQuestionId(questionId, userinfoId);

        return R.ok(rs);
    }

    /**
     * 获取回答数量
     * @param params userinfoId
     * @return 数量
     */
    @PostMapping("/getCount")
    public R getCount(@RequestBody Map<String, Object> params){
        int userinfoId = idIsNull(params.get("userinfoId"), "用户ID");
        long count = serviceAnswer.getCount(userinfoId);
        return R.ok(new DtoAnswer().setCount(count));
    }

}
