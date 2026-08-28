package com.pango.controller;

import com.pango.entity.DtoAnswer;
import com.pango.entity.DtoQuestion;
import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceAnswer;
import com.pango.service.ServiceAuth;
import com.pango.service.ServiceQuestion;
import com.pango.service.ServiceUserinfo;
import com.pango.utils.MyAssert;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import javax.annotation.Resource;
import java.util.Map;
import java.util.List;
import java.util.Collections;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.Objects;

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
    @Resource
    private ServiceAuth serviceAuth;

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
        com.pango.entity.DtoUserinfo historyUser = serviceUserinfo.getById(userId);
        long count = historyUser != null && "GUEST".equals(historyUser.getUserType())
                ? (historyUser.getQuotaUsed() == null ? 0 : historyUser.getQuotaUsed())
                : serviceAnswer.getCount(userId);
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
     * 隐藏单个会话或全部历史记录，不删除问题与回答内容。
     */
    @PostMapping("/hideHistory")
    public R hideHistory(
            @RequestBody Map<String, Object> params,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        DtoUserinfo user = serviceAuth.resolveUser(authorization);
        int userId = Math.toIntExact(user.getId());
        if (params.containsKey("userinfoId")) {
            int requestedUserId = idIsNull(params.get("userinfoId"), "用户ID");
            if (requestedUserId != userId) {
                throw new MyException("用户身份不匹配");
            }
        }
        Object rawSessionId = params.get("sessionId");
        String sessionId = rawSessionId == null ? "" : String.valueOf(rawSessionId).trim();
        if (sessionId.isEmpty()) {
            serviceQuestion.hideAllHistory(userId);
        } else {
            serviceQuestion.hideSession(userId, sessionId);
        }
        return R.ok();
    }

    /**
     * 兼容旧客户端：原删除入口现在只隐藏历史记录。
     * @param params userinfoId
    */
    @PostMapping("/doDelHis")
    public R doDelHis(
            @RequestBody Map<String, Object> params,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        params.remove("sessionId");
        return hideHistory(params, authorization);
    }

}
