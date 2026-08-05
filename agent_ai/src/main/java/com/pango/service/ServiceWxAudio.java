package com.pango.service;

import com.pango.exception.MyException;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.util.Base64;
import java.util.Locale;
import java.util.Objects;

/** 使用阿里云百炼 -Audio-3.0-ASR-Flash 进行短音频识别。 */
@Service
@Slf4j
public class ServiceWxAudio {

    // 百炼限制 Base64 编码后的音频不超过 10 MB，原文件限制为 7 MB以预留空间。
    private static final long MAX_AUDIO_SIZE = 7L * 1024 * 1024;

    @Value("${ali_audio.api-key:}")
    private String apiKey;
    @Value("${ali_audio.workspace-id:}")
    private String workspaceId;
    @Value("${ali_audio.endpoint-template:https://%s.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation}")
    private String endpointTemplate;
    @Value("${ali_audio.model:-audio-3.0-asr-flash}")
    private String model;
    @Value("${ali_audio.sample-rate:16000}")
    private int sampleRate;

    @Resource
    private RestTemplate restTemplate;

    public String getTextByAudio(MultipartFile audioFile) {
        validateAudio(audioFile);
        AudioFormat audioFormat = resolveFormat(audioFile);
        try {
            byte[] audioBytes = audioFile.getBytes();
            String dataUrl = "data:" + audioFormat.mimeType + ";base64,"
                    + Base64.getEncoder().encodeToString(audioBytes);
            String endpoint = resolveEndpoint();
            log.info("准备调用语音识别，fileName={}，contentType={}，size={}，format={}，sampleRate={}，model={}",
                    audioFile.getOriginalFilename(), audioFile.getContentType(), audioBytes.length,
                    audioFormat.format, sampleRate, model);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey.trim());
            headers.set("X-DashScope-SSE", "disable");
            HttpEntity<String> request = new HttpEntity<>(
                    buildRequest(dataUrl, audioFormat.format).toString(), headers);
            return parseResponse(parseJson(executeRequest(endpoint, request)));
        } catch (MyException e) {
            throw e;
        } catch (Exception e) {
            log.error("语音识别调用失败", e);
            throw new MyException("调用语音识别服务失败：" + e.getMessage());
        }
    }

    private JSONObject buildRequest(String dataUrl, String format) {
        JSONObject content = new JSONObject()
                .put("type", "input_audio")
                .put("input_audio", new JSONObject().put("data", dataUrl));
        JSONObject message = new JSONObject()
                .put("role", "user")
                .put("content", new JSONArray().put(content));
        return new JSONObject()
                .put("model", model)
                .put("input", new JSONObject().put("messages", new JSONArray().put(message)))
                .put("parameters", new JSONObject()
                        .put("format", format)
                        .put("sample_rate", String.valueOf(sampleRate)));
    }

    private String executeRequest(String endpoint, HttpEntity<String> request) {
        try {
            ResponseEntity<String> response = restTemplate.postForEntity(endpoint, request, String.class);
            return response.getBody();
        } catch (HttpStatusCodeException e) {
            String body = e.getResponseBodyAsString();
            log.warn("语音识别HTTP响应异常，httpStatus={}，body={}", e.getRawStatusCode(), body);
            if (!isBlank(body)) {
                JSONObject error = parseJson(body);
                throw new MyException("语音识别失败："
                        + error.optString("code", String.valueOf(e.getRawStatusCode())) + " - "
                        + error.optString("message", "请求失败"));
            }
            throw new MyException("语音识别失败：HTTP " + e.getRawStatusCode());
        }
    }

    private JSONObject parseJson(String body) {
        if (isBlank(body)) throw new MyException("语音识别服务未返回内容");
        try {
            return new JSONObject(body);
        } catch (Exception e) {
            throw new MyException("语音识别服务返回了无效内容");
        }
    }

    private String parseResponse(JSONObject json) {
        if (json.has("code")) {
            throw new MyException("语音识别失败：" + json.optString("code") + " - "
                    + json.optString("message", "未知错误"));
        }
        String requestId = json.optString("request_id", "");
        JSONObject output = json.optJSONObject("output");
        String result = output == null ? "" : output.optString("text", "").trim();
        if (result.isEmpty()) {
            throw new MyException("未识别到有效语音"
                    + (requestId.isEmpty() ? "" : " (requestId=" + requestId + ")"));
        }
        log.info("语音识别完成，requestId={}", requestId);
        return result;
    }

    private String resolveEndpoint() {
        if (isBlank(apiKey)) throw new MyException("未配置百炼API Key，请设置DASHSCOPE_API_KEY");
        if (isBlank(workspaceId)) throw new MyException("未配置百炼业务空间ID，请设置DASHSCOPE_WORKSPACE_ID");
        return String.format(endpointTemplate, workspaceId.trim());
    }

    private void validateAudio(MultipartFile audioFile) {
        if (audioFile == null || audioFile.isEmpty()) throw new MyException("音频文件无效");
        if (audioFile.getSize() > MAX_AUDIO_SIZE) {
            throw new MyException("音频文件过大，请上传不超过7MB、时长不超过5分钟的音频");
        }
        if (sampleRate <= 0) throw new MyException("ali_audio.sample-rate必须大于0");
    }

    private AudioFormat resolveFormat(MultipartFile audioFile) {
        String filename = Objects.toString(audioFile.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
        if (filename.endsWith(".wav")) return new AudioFormat("wav", "audio/wav");
        if (filename.endsWith(".mp3")) return new AudioFormat("mp3", "audio/mpeg");
        if (filename.endsWith(".aac")) return new AudioFormat("aac", "audio/aac");
        if (filename.endsWith(".m4a")) return new AudioFormat("m4a", "audio/mp4");
        if (filename.endsWith(".amr")) return new AudioFormat("amr", "audio/amr");
        if (filename.endsWith(".opus")) return new AudioFormat("opus", "audio/opus");
        if (filename.endsWith(".ogg")) return new AudioFormat("ogg", "audio/ogg");
        if (filename.endsWith(".flac")) return new AudioFormat("flac", "audio/flac");
        throw new MyException("不支持的音频格式，请上传WAV、MP3、AAC、M4A、AMR、OPUS、OGG或FLAC音频");
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static class AudioFormat {
        private final String format;
        private final String mimeType;
        private AudioFormat(String format, String mimeType) {
            this.format = format;
            this.mimeType = mimeType;
        }
    }
}
