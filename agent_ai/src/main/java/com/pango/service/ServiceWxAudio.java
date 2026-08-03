package com.pango.service;

import com.alibaba.nls.client.AccessToken;
import com.pango.exception.MyException;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import javax.annotation.Resource;
import java.util.Locale;
import java.util.Objects;

/**
 * 阿里云智能语音交互一句话识别 RESTful 服务。
 */
@Service
@Slf4j
public class ServiceWxAudio {

    private static final long MAX_AUDIO_SIZE = 2L * 1024 * 1024;
    private static final long SUCCESS_STATUS = 20000000L;

    @Value("${ali_audio.appkey}")
    private String appKey;

    @Value("${ali_audio.access-key-id:}")
    private String accessKeyId;

    @Value("${ali_audio.access-key-secret:}")
    private String accessKeySecret;

    @Value("${ali_audio.token:}")
    private String configuredToken;

    @Value("${ali_audio.rest-url:https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr}")
    private String restUrl;

    @Value("${ali_audio.sample-rate:16000}")
    private int sampleRate;

    @Resource
    private RestTemplate restTemplate;

    public String getTextByAudio(MultipartFile audioFile) {
        validateAudio(audioFile);
        String format = resolveFormat(audioFile);

        try {
            byte[] audioBytes = audioFile.getBytes();
            log.info("准备识别音频，fileName={}，contentType={}，size={}，format={}，sampleRate={}",
                    audioFile.getOriginalFilename(), audioFile.getContentType(), audioBytes.length,
                    format, sampleRate);
            String url = UriComponentsBuilder.fromHttpUrl(restUrl)
                    .queryParam("appkey", appKey)
                    .queryParam("format", format)
                    .queryParam("sample_rate", sampleRate)
                    .queryParam("enable_punctuation_prediction", true)
                    .queryParam("enable_inverse_text_normalization", true)
                    .build(true)
                    .toUriString();

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.setContentLength(audioBytes.length);
            headers.set("X-NLS-Token", getAccessToken());

            HttpEntity<byte[]> request = new HttpEntity<>(audioBytes, headers);
            String body = executeRequest(url, request);
            return parseResponse(parseJson(body));
        } catch (MyException e) {
            throw e;
        } catch (Exception e) {
            log.error("阿里云语音识别失败", e);
            throw new MyException("调用阿里云语音识别失败：" + e.getMessage());
        }
    }

    private String executeRequest(String url, HttpEntity<byte[]> request) {
        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.POST, request, String.class);
            return response.getBody();
        } catch (HttpStatusCodeException e) {
            String body = e.getResponseBodyAsString();
            log.warn("阿里云语音识别HTTP响应，httpStatus={}，body={}",
                    e.getRawStatusCode(), body);
            return body;
        }
    }

    private JSONObject parseJson(String body) {
        if (isBlank(body)) {
            throw new MyException("阿里云语音识别未返回内容");
        }
        try {
            return new JSONObject(body);
        } catch (Exception e) {
            throw new MyException("阿里云语音识别返回了非JSON内容：" + body);
        }
    }

    private String parseResponse(JSONObject json) {
        long status = json.optLong("status", -1L);
        String taskId = json.optString("task_id", "");
        if (status != SUCCESS_STATUS) {
            String message = json.optString("message", "未知错误");
            throw new MyException("阿里云语音识别失败：" + status + " - " + message
                    + (taskId.isEmpty() ? "" : " (taskId=" + taskId + ")"));
        }
        String result = json.optString("result", "").trim();
        if (result.isEmpty()) {
            throw new MyException("未识别到有效语音"
                    + (taskId.isEmpty() ? "" : " (taskId=" + taskId + ")"));
        }
        log.info("阿里云语音识别完成，taskId={}", taskId);
        return result;
    }

    private String getAccessToken() throws Exception {
        if (!isBlank(configuredToken)) {
            return configuredToken.trim();
        }
        if (isBlank(accessKeyId) || isBlank(accessKeySecret)) {
            throw new MyException("未配置阿里云鉴权信息，请配置ali_audio.token，"
                    + "或同时配置ali_audio.access-key-id和ali_audio.access-key-secret");
        }
        AccessToken accessToken = new AccessToken(accessKeyId.trim(), accessKeySecret.trim());
        accessToken.apply();
        return accessToken.getToken();
    }

    private void validateAudio(MultipartFile audioFile) {
        if (audioFile == null || audioFile.isEmpty()) {
            throw new MyException("音频文件无效");
        }
        if (audioFile.getSize() > MAX_AUDIO_SIZE) {
            throw new MyException("阿里云一句话识别要求音频文件不超过2MB");
        }
        if (sampleRate != 8000 && sampleRate != 16000) {
            throw new MyException("ali_audio.sample-rate仅支持8000或16000");
        }
    }

    private String resolveFormat(MultipartFile audioFile) {
        String filename = Objects.toString(audioFile.getOriginalFilename(), "").toLowerCase(Locale.ROOT);
        if (filename.endsWith(".aac")) return "aac";
        if (filename.endsWith(".m4a")) {
            throw new MyException("M4A是MP4容器格式，不能按AAC原始音频提交，请使用MP3录音");
        }
        if (filename.endsWith(".mp3")) return "mp3";
        if (filename.endsWith(".wav")) return "wav";
        if (filename.endsWith(".amr")) return "amr";
        if (filename.endsWith(".opus") || filename.endsWith(".ogg")) return "opus";
        if (filename.endsWith(".speex")) return "speex";
        if (filename.endsWith(".pcm")) return "pcm";
        throw new MyException("不支持的音频格式，请上传AAC、MP3、WAV、AMR、OPUS、SPEEX或PCM音频");
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
