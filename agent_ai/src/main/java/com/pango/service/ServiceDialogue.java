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
import java.util.function.Consumer;

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
        return proxyStream(requestBody, ignored -> { });
    }

    public Flux<String> proxyStream(Map<String, Object> requestBody, Consumer<StreamAnswerResult> onComplete) {
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
        StreamAnswerCollector collector = new StreamAnswerCollector();
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
                .bodyToFlux(String.class)
                .doOnNext(collector::accept)
                .doOnComplete(() -> onComplete.accept(collector.result()));
    }

    public static class StreamAnswerResult {
        private final boolean terminal;
        private final String content;
        private final String reference;
        private final String answerMedia;

        private StreamAnswerResult(boolean terminal, String content, String reference, String answerMedia) {
            this.terminal = terminal;
            this.content = content;
            this.reference = reference;
            this.answerMedia = answerMedia;
        }

        public boolean isTerminal() { return terminal; }
        public String getContent() { return content; }
        public String getReference() { return reference; }
        public String getAnswerMedia() { return answerMedia; }
    }

    private static class StreamAnswerCollector {
        private final StringBuilder content = new StringBuilder();
        private boolean terminal;
        private Object reference;
        private Object answerMedia;

        private void accept(String frame) {
            if (frame == null) return;
            String raw = frame.trim();
            if (raw.startsWith("data:")) raw = raw.substring(5).trim();
            if (raw.isEmpty() || "[DONE]".equals(raw)) return;
            try {
                JSONObject payload = JSONObject.parseObject(raw);
                Object dataValue = payload.get("data");
                JSONObject data = dataValue instanceof JSONObject ? (JSONObject) dataValue : null;
                if (Boolean.TRUE.equals(dataValue) || payload.getBooleanValue("answer_replace")) {
                    terminal = true;
                    String finalAnswer = payload.getString("answer");
                    if ((finalAnswer == null || finalAnswer.isEmpty()) && data != null) {
                        finalAnswer = data.getString("answer");
                    }
                    if (payload.getBooleanValue("answer_replace") && finalAnswer != null && !finalAnswer.isEmpty()) {
                        content.setLength(0);
                        content.append(finalAnswer);
                    } else if (content.length() == 0 && finalAnswer != null) {
                        content.append(finalAnswer);
                    }
                    reference = payload.containsKey("reference") ? payload.get("reference")
                            : data == null ? null : data.get("reference");
                    answerMedia = payload.containsKey("answer_media") ? payload.get("answer_media")
                            : data == null ? null : data.get("answer_media");
                    return;
                }
                if (data != null && data.get("answer") != null) {
                    content.append(data.getString("answer"));
                } else if ("message".equals(payload.getString("event")) && data != null) {
                    String message = data.getString("content");
                    if (message != null) content.append(message);
                }
            } catch (Exception ignored) {
                // Only valid model protocol frames are eligible for persistence.
            }
        }

        private StreamAnswerResult result() {
            return new StreamAnswerResult(
                    terminal,
                    content.toString(),
                    reference == null ? null : JSONObject.toJSONString(reference),
                    answerMedia == null ? null : JSONObject.toJSONString(answerMedia));
        }
    }

}

