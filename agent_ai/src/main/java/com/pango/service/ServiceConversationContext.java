package com.pango.service;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.pango.entity.DtoAnswer;
import com.pango.entity.DtoQuestion;
import com.pango.exception.MyException;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.stream.Collectors;

@Service
public class ServiceConversationContext {
    private static final int MAX_CONTEXT_TURNS = 100;

    @Resource
    private ServiceQuestion serviceQuestion;
    @Resource
    private ServiceAnswer serviceAnswer;

    public JSONObject build(DtoQuestion currentQuestion) {
        if (currentQuestion == null || currentQuestion.getId() == null
                || currentQuestion.getUserinfoId() == null
                || currentQuestion.getSessionId() == null
                || currentQuestion.getSessionId().trim().isEmpty()) {
            throw new MyException("当前问题缺少会话信息");
        }
        DtoQuestion stored = serviceQuestion.getById(currentQuestion.getId());
        if (stored == null
                || !currentQuestion.getUserinfoId().equals(stored.getUserinfoId())
                || !currentQuestion.getSessionId().equals(stored.getSessionId())) {
            throw new MyException("当前问题与会话不匹配");
        }

        List<DtoQuestion> history = serviceQuestion.findContextHistory(
                stored.getUserinfoId(), stored.getSessionId(), stored.getId(), MAX_CONTEXT_TURNS);
        List<Long> questionIds = history.stream().map(DtoQuestion::getId).collect(Collectors.toList());
        Map<Long, DtoAnswer> answerByQuestion = new HashMap<>();
        for (DtoAnswer answer : serviceAnswer.getByQuestionIds(questionIds, stored.getUserinfoId())) {
            if (answer.getContent() != null && !answer.getContent().trim().isEmpty()) {
                answerByQuestion.putIfAbsent(answer.getQuestionId(), answer);
            }
        }

        JSONArray messages = new JSONArray();
        for (DtoQuestion question : history) {
            messages.add(message("msg-" + question.getId() + ":user", "user",
                    question.getQuestion(), question.getDotime()));
            DtoAnswer answer = answerByQuestion.get(question.getId());
            if (answer != null) {
                Date createdAt = answer.getDotime() == null ? question.getDotime() : answer.getDotime();
                messages.add(message("msg-" + question.getId() + ":assistant", "assistant",
                        answer.getContent(), createdAt));
            }
        }

        JSONObject context = new JSONObject();
        context.put("current_turn_id", "msg-" + stored.getId());
        context.put("messages", messages);
        return context;
    }

    public JSONObject build(long currentQuestionId, String sessionId) {
        DtoQuestion question = serviceQuestion.getById(currentQuestionId);
        if (question == null || sessionId == null || !sessionId.equals(question.getSessionId())) {
            throw new MyException("当前问题与会话不匹配");
        }
        return build(question);
    }

    private JSONObject message(String messageId, String role, String content, Date createdAt) {
        JSONObject message = new JSONObject();
        message.put("message_id", messageId);
        message.put("role", role);
        message.put("content", content == null ? "" : content);
        message.put("created_at", formatTime(createdAt));
        return message;
    }

    private String formatTime(Date value) {
        if (value == null) return null;
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX");
        formatter.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        return formatter.format(value);
    }
}
