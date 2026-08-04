package com.pango.service;

import com.alibaba.fastjson.JSONObject;
import com.pango.rs.R;
import com.pango.exception.MyException;
import com.pango.utils.UtilsValue;
import com.pango.vo.VoDialogueSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.Assert;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import javax.annotation.Resource;
import java.util.Map;

/**
 * Created by Pango on 09/05/2018.
 * ServiceDialogue
 */
@Service
public class ServiceDialogue {

    @Value("${dialogue.url}")
    private String dialogueUrl;
    @Value("${dialogue.authorization}")
    private String dialogueAuthorization;
    @Value("${dialogue.question}")
    private String dialogueQuestion;
    @Value("${dialogue.conversation_id}")
    private String dialogueConversationId;
    @Value("${dialogue.quote}")
    private boolean dialogueQuote;
    @Resource
    private RestTemplate restTemplate;
    @Resource
    private WebClient webClient;

    /**
     * 取得每一次会话的sessionId
     */
    public VoDialogueSession getSessionId() {
        // 准备请求体
        JSONObject requestBody = new JSONObject();
        requestBody.put("question", dialogueQuestion);
        HttpHeaders headers = new HttpHeaders();
        headers.add("authorization", dialogueAuthorization);
        // 构建请求实体
        HttpEntity<String> request = new HttpEntity<>(requestBody.toString(), headers);
        // 发送POST请求
        ResponseEntity<String> response = restTemplate.exchange(dialogueUrl, HttpMethod.POST, request, String.class);
        // 处理响应数据
        String responseBody = response.getBody();
        Assert.state(null != responseBody, "解析对象出错");
        //取第一行
        String text = responseBody.split("\n\n")[0].trim();
        //去掉前面的“data:”
        text = text.substring(5);
        //解析对象
        R rs = JSONObject.parseObject(text, R.class);
        Assert.state(null != rs, "解析对象出错-1");
        VoDialogueSession sessionRs = JSONObject.parseObject(rs.getData().toString(), VoDialogueSession.class);
        Assert.state(null != sessionRs, "解析对象出错-2");
        return sessionRs;
    }

    /**
     * 获取答案
     * @param question  问题
     * @return  答案
     */
    public String getAnswer(String question) {
        // 取得sessionId
        VoDialogueSession sessionRs = getSessionId();
        // 准备请求体
        JSONObject requestBody = new JSONObject();
        requestBody.put("question", question);
        requestBody.put("quote", dialogueQuote);
        requestBody.put("conversation_id", dialogueConversationId);
        requestBody.put("session_id", sessionRs.getSession_id());
        HttpHeaders headers = new HttpHeaders();
        headers.add("authorization", dialogueAuthorization);
        // 构建请求实体
        HttpEntity<String> request = new HttpEntity<>(requestBody.toString(), headers);
        // 发送POST请求
        ResponseEntity<String> response = restTemplate.exchange(dialogueUrl, HttpMethod.POST, request, String.class);
        // 处理响应数据
        String responseBody = response.getBody();


        return responseBody;
    }

    public Flux<String> getStreamAnswer(String question, int userinfoId) {
        //VoDialogueSession session = getSessionId();
        JSONObject requestBody = new JSONObject();
        requestBody.put("question", question);
        requestBody.put("quote", dialogueQuote);
        requestBody.put("conversation_id", dialogueConversationId);
        requestBody.put("session_id", "aaaa");

        return webClient.post()
                .uri(dialogueUrl)
                .header("authorization", dialogueAuthorization)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(requestBody.toString())
                .retrieve()
                .bodyToFlux(String.class)
                .takeWhile(index -> UtilsValue.streamFlags.get(userinfoId).get())
                .map(this::parseChunk)
                .distinctUntilChanged();
    }

    private String parseChunk(String chunk) {
        if("".equals(chunk)){
            return "";
        }
        String chunkText = chunk.replaceAll("\\\\r\\\\n|\\\\r|\\\\n", "<br />");
        System.out.println(chunkText);
        try {
            R rs1 = JSONObject.parseObject(chunkText, R.class);
            if(rs1 == null){
                return "[DONE]";
            }
            VoDialogueSession rs2 = JSONObject.parseObject(rs1.getData().toString(), VoDialogueSession.class);
            if(rs2 == null){
                return rs1.getData().toString();
            }
            if(rs1.getData().toString().equals("true")){
                return "[DONE]";
            }
            return rs2.getAnswer();
        } catch (Exception e) {
            return "[DONE]";
        }
    }

    public Flux<String> proxyStream(Map<String, Object> requestBody) {
        Object rawSessionId = requestBody.get("session_id");
        String sessionId = rawSessionId == null ? "" : String.valueOf(rawSessionId).trim();
        if (sessionId.isEmpty()) {
            throw new MyException("会话ID不能为空");
        }
        if (!sessionId.matches("^[A-Za-z0-9_-]{8,100}$")) {
            throw new MyException("会话ID格式不正确");
        }

        JSONObject body = new JSONObject(requestBody);
        body.putIfAbsent("quote", dialogueQuote);
        body.putIfAbsent("conversation_id", dialogueConversationId);
        return webClient.post()
                .uri(dialogueUrl)
                .header("authorization", dialogueAuthorization)
                // Nginx uses this trusted header for consistent-hash routing.
                // It is derived from the validated JSON body, not forwarded from the client.
                .header("X-Session-Id", sessionId)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .bodyValue(body.toString())
                .retrieve()
                .bodyToFlux(String.class);
    }

}

