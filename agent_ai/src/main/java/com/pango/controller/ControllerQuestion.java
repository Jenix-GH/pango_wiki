package com.pango.controller;

import com.pango.entity.DtoQuestion;
import com.pango.rs.R;
import com.pango.service.ServiceAnswer;
import com.pango.service.ServiceQuestion;
import com.pango.service.ServiceUserinfo;
import com.pango.utils.MyAssert;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import javax.annotation.Resource;
import java.util.Map;
import java.util.List;
import java.util.Collections;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.Objects;
import com.pango.entity.DtoAnswer;

/**
 * 问题控制入口
 */
@RestController
@RequestMapping("/question")
@Slf4j
public class ControllerQuestion implements MyAssert {

    @Resource
    private ServiceQuestion serviceQuestion;
    @Resource
    private ServiceAnswer serviceAnswer;
    @Resource
    private ServiceUserinfo serviceUserinfo;

    /**
     * 添加问题
     * @param obj DtoQuestion
     */
    @PostMapping("/doAdd")
    public R doAdd(@RequestBody DtoQuestion obj){
        idIsNull(obj.getUserinfoId(), "用户ID");
        strIsNull(obj.getQuestionType(), "问题类型");
        strIsNull(obj.getQuestion(), "问题");
//        idIsNull(obj.getInternetEnable(), "联网搜索");
        serviceQuestion.doAdd(obj);
        return R.ok(serviceQuestion.findTodayByUserId(Math.toIntExact(obj.getUserinfoId())));
    }

    /**
     * 查询用户历史问题
     * @param params userinfoId
     */
    @PostMapping("/findHisByUserId")
    public R findHisByUserId(@RequestBody Map<String, Object> params){
        int userId = idIsNull(params.get("userinfoId"), "用户ID");
        DtoQuestion rs = serviceQuestion.findHisByUserId(userId);
        long count = serviceAnswer.getCount(userId);
        rs.setCount(count); //返回用户当前回答条数
        int flagCompany = serviceUserinfo.getCompany(userId);
        rs.setFlagCompanyInfo(flagCompany != 0); //返回用户是否有填写公司信息
        return R.ok(rs);
    }

    @PostMapping("/findBySessionId")
    public R findBySessionId(@RequestBody Map<String, Object> params){
        int userId = idIsNull(params.get("userinfoId"), "用户ID");
        String sessionId = strIsNull(params.get("sessionId"), "会话ID");
        List<DtoQuestion> questions;
        if (sessionId.startsWith("legacy_")) {
            long questionId = Long.parseLong(sessionId.substring("legacy_".length()));
            DtoQuestion question = serviceQuestion.getById(questionId);
            if (question == null || !Objects.equals(question.getUserinfoId(), (long) userId)
                    || !Objects.equals(question.getFlagDel(), 0)) {
                return R.ok(Collections.emptyList());
            }
            questions = Collections.singletonList(question);
        } else {
            questions = serviceQuestion.findSession(userId, sessionId);
        }
        List<Long> ids = questions.stream().map(DtoQuestion::getId).collect(Collectors.toList());
        Map<Long, DtoAnswer> answers = serviceAnswer.getByQuestionIds(ids, userId).stream()
                .collect(Collectors.toMap(DtoAnswer::getQuestionId, Function.identity(), (first, ignored) -> first));
        questions.forEach(question -> question.setAnswer(answers.get(question.getId())));
        return R.ok(questions);
    }

    /**
     * 查询用户当天的历史问题
     * @param params userinfoId
     */
    @PostMapping("/findTodayByUserId")
    public R findTodayByUserId(@RequestBody Map<String, Object> params){
        int userId = idIsNull(params.get("userinfoId"), "用户ID");
        DtoQuestion rs = serviceQuestion.findTodayByUserId(userId);
        return R.ok(rs);
    }

    /**
     * 删除用户历史问题
     * @param params userinfoId
     */
    @PostMapping("/doDelHis")
    public R doDelHis(@RequestBody Map<String, Object> params){
        int userId = idIsNull(params.get("userinfoId"), "用户ID");
        serviceQuestion.doRemoveHis(userId);
        return R.ok();
    }

}
