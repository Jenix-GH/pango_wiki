package com.pango.controller;

import com.alibaba.fastjson.JSON;
import com.pango.service.ServiceDialogue;
import com.pango.service.ServiceAuth;
import com.pango.service.ServiceQuestion;
import com.pango.service.ServiceUserinfo;
import com.pango.service.ServiceAnalytics;
import com.pango.entity.DtoQuestion;
import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import com.pango.utils.MyAssert;
import com.pango.utils.UtilsValue;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import javax.annotation.Resource;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 对话控制器
 * Created by Pango on 05/05/2017.
 */
@Slf4j
@RestController
@RequestMapping("/dialogue")
public class ControllerDialogue implements MyAssert {

    @Resource
    private ServiceDialogue serviceDialogue;
    @Resource
    private ServiceAuth serviceAuth;
    @Resource
    private ServiceUserinfo serviceUserinfo;
    @Resource
    private ServiceQuestion serviceQuestion;
    @Resource
    private ServiceAnalytics serviceAnalytics;
    String content = "<think>首先，用户重复了系统提示文本，没有提供具体的技术问题。根据我的职责，我需要礼貌地回复，并委婉拒绝非技术问题。系统要求中提到：\"若为非技术问题，请礼貌回复，委婉拒绝。\" 所以，我不能直接回答这个输入，因为它不是技术问题。<br /><br />用户的问题内容是关于我自己的介绍和请求具体问题的文本，这属于非技术问题。因此，我应该：<br /><br />1. 礼貌回应。<br />2. 委婉拒绝。<br />3. 重申我的职责范围，并鼓励用户提供具体技术问题。<br /><br />系统提示中还指定：\"若用户提问超出知识库范围，请礼貌回答不知道，禁止回答不相关的东西。\" 但这里不是超出知识库范围，而是根本就不是一个提问；它是系统提示的重复。<br /><br />我的响应需要：<br />- 使用全中文。<br />- 逐步思考，但输出要精简。<br />- 最后输出免责声明：\"该回答仅供参考，具体请参考相关手册或咨询FAE。\"<br /><br />所以，思考过程：<br />- 步骤1：识别用户输入——这是系统介绍文本，没有具体问题。<br />- 步骤2：根据规则，礼貌拒绝。<br />- 步骤3：重新提示用户提供具体技术问题。<br />- 步骤4：确保响应精简，重点突出。<br />- 步骤5：以免责声明结束。<br /><br />响应结构：<br />- 开头：感谢用户。<br />- 主体：解释输入没有具体问题，委婉拒绝。<br />- 结尾：鼓励提供问题，并添加免责声明。<br /><br />最终输出：<br />- 全中文。<br />- 精简：直接点明问题，不扩展。</think>您好！感谢您联系紫光同创FPGA技术支持服务。您的输入内容仍为系统介绍文本，未包含具体技术问题（如器件型号、功能模块或应用场景）。作为智能助手，我专注于解答**Compact、Logos、Logos2、Titan2、Kosmo2系列**的器件选型、功能特性或PDS工具应用相关技术问题。  <br /><br />请提供具体技术需求（例如：PG2L100H的HSSTLP最高速率、PG2T160H的DDR4布线要求等），我将基于知识库文档（如《产品替代选型对比表》《Logos2系列FPGA器件数据手册》）精准解答。  <br /><br />该回答仅供参考，具体请参考相关手册或咨询FAE。";

    @GetMapping("/question")
    public String doQuestion() {

        return serviceDialogue.getAnswer("你是谁？");
    }

    @PostMapping("/stop-stream-answer")
    public void stopStreamAnswer(@RequestBody Map<String, Object> params) {
        int userinfoId = idIsNull(params.get("userinfoId"), "用户ID");
        AtomicBoolean cancelFlag =  UtilsValue.streamFlags.get(userinfoId);
        if (cancelFlag != null && cancelFlag.get()) {
            UtilsValue.streamFlags.put(userinfoId, new AtomicBoolean(false));
        }
    }

    @PostMapping(value = "/stream-answer", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamAnswer(
            @RequestBody Map<String, Object> params,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        DtoUserinfo user = serviceAuth.resolveUser(authorization);
        Object requestedUserId = params.get("userinfoId");
        if (requestedUserId != null && Long.parseLong(String.valueOf(requestedUserId)) != user.getId()) {
            throw new MyException("用户身份不匹配");
        }
        String question = strIsNull(params.get("question"), "问题");
        String clientType = "MINIPROGRAM".equalsIgnoreCase(String.valueOf(params.get("client_type")))
                ? "MINIPROGRAM" : "WEB";
        String sessionId = params.get("session_id") == null ? null : String.valueOf(params.get("session_id"));
        Object questionImages = params.get("images");
        serviceUserinfo.consumeGuestQuota(user.getId());

        DtoQuestion record = new DtoQuestion()
                .setUserinfoId(user.getId())
                .setQuestion(question)
                .setQuestionType("1")
                .setSessionId(sessionId)
                .setQuestionImages(questionImages == null ? null : JSON.toJSONString(questionImages));
        serviceQuestion.doAdd(record);
        serviceAnalytics.recordQuietly("chat_submit", "/", clientType, user.getId(), sessionId, null);

        params.remove("userinfoId");
        params.remove("client_type");
        return serviceDialogue.proxyStream(params)
                .doOnComplete(() -> serviceAnalytics.recordQuietly("chat_success", "/", clientType,
                        user.getId(), sessionId, null))
                .doOnError(error -> serviceAnalytics.recordQuietly("chat_failed", "/", clientType,
                        user.getId(), sessionId, null));
    }


//    @PostMapping(value = "/stream-answer", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
//    public Flux<String> streamAnswer(@RequestBody Map<String, Object> params) {
//        int userinfoId = idIsNull(params.get("userinfoId"), "用户ID");
//        UtilsValue.streamFlags.put(userinfoId, new AtomicBoolean(true)); //先停止历史的问答
//        String question = strIsNull(params.get("question"), "问题");
//        UtilsValue.streamFlags.put(userinfoId, new AtomicBoolean(true));
//        //return serviceDialogue.getStreamAnswer(question + "");
//
//        String content = "<think>首先，用户重复了系统提示文本，没有提供具体的技术问题。根据我的职责，我需要礼貌地回复，并委婉拒绝非技术问题。系统要求中提到：\"若为非技术问题，请礼貌回复，委婉拒绝。\" 所以，我不能直接回答这个输入，因为它不是技术问题。<br /><br />用户的问题内容是关于我自己的介绍和请求具体问题的文本，这属于非技术问题。因此，我应该：<br /><br />1. 礼貌回应。<br />2. 委婉拒绝。<br />3. 重申我的职责范围，并鼓励用户提供具体技术问题。<br /><br />系统提示中还指定：\"若用户提问超出知识库范围，请礼貌回答不知道，禁止回答不相关的东西。\" 但这里不是超出知识库范围，而是根本就不是一个提问；它是系统提示的重复。<br /><br />我的响应需要：<br />- 使用全中文。<br />- 逐步思考，但输出要精简。<br />- 最后输出免责声明：\"该回答仅供参考，具体请参考相关手册或咨询FAE。\"<br /><br />所以，思考过程：<br />- 步骤1：识别用户输入——这是系统介绍文本，没有具体问题。<br />- 步骤2：根据规则，礼貌拒绝。<br />- 步骤3：重新提示用户提供具体技术问题。<br />- 步骤4：确保响应精简，重点突出。<br />- 步骤5：以免责声明结束。<br /><br />响应结构：<br />- 开头：感谢用户。<br />- 主体：解释输入没有具体问题，委婉拒绝。<br />- 结尾：鼓励提供问题，并添加免责声明。<br /><br />最终输出：<br />- 全中文。<br />- 精简：直接点明问题，不扩展。</think>您好！感谢您联系紫光同创FPGA技术支持服务。您的输入内容仍为系统介绍文本，未包含具体技术问题（如器件型号、功能模块或应用场景）。作为智能助手，我专注于解答**Compact、Logos、Logos2、Titan2、Kosmo2系列**的器件选型、功能特性或PDS工具应用相关技术问题。  <br /><br />请提供具体技术需求（例如：PG2L100H的HSSTLP最高速率、PG2T160H的DDR4布线要求等），我将基于知识库文档（如《产品替代选型对比表》《Logos2系列FPGA器件数据手册》）精准解答。  <br /><br />该回答仅供参考，具体请参考相关手册或咨询FAE。";
//        //content = "<think>首先，添加免责声明。<br /><br />最终输出：<br />- 全中文。<br />- 精简：直接点明问题，不扩展。</think>您好！感谢您联系紫光同创FPGA技术支持服务。您的输入内容仍为系统介绍文本，未包含具体技术问题（如器件型号、功能模块或应用场景）。作为智能助手，我专注于解答**Compact、Logos、Logos2、Titan2、Kosmo2系列**的器件选型、功能特性或PDS工具应用相关技术问题。  <br /><br />请提供具体技术需求（例如：PG2L100H的HSSTLP最高速率、PG2T160H的DDR4布线要求等），我将基于知识库文档（如《产品替代选型对比表》《Logos2系列FPGA器件数据手册》）精准解答。  <br /><br />该回答仅供参考，具体请参考相关手册或咨询FAE。";
//        //content = "<think>首先，用户重复了系统提示文本，没有提供具体的技术问题。根据我的职责，我需要礼貌地回复，并委婉拒绝非技术问题。系统要求中提到：\"若为非技术问题，请礼貌回复，委婉拒绝。\" 所以，我不能直接回答这个输入，因为它不是技术问题。<br /><br />用户的问题内容是关于我自己的介绍和请求具体问题的文本，这属于非技术问题。因此，我应该：<br /><br />1. 礼貌回应。<br />2. 委婉拒绝。<br />3. 重申我的职责范围，并鼓励用户提供具体技术问题。<br /><br />系统提示中还指定：\"若用户提问超出知识库范围，请礼貌回答不知道，禁止回答不相关的东西。";
//        // 将内容转为字符数组
//        char[] chars = content.toCharArray();
//        String endMarker = "[DONE]"; // 结束标识字符串
//        return Flux.interval(Duration.ofMillis(80))
//                .take(chars.length + 1) // +1用于发送结束标记
//                .map(index -> {
//                    if (index < chars.length) {
//                        // 返回当前字符+累计内容
//                        StringBuilder sb = new StringBuilder();
//                        for (int i = 0; i <= index; i++) {
//                            sb.append(chars[i]);
//                        }
//                        return sb.toString();
//                    } else {
//                        return endMarker; // 最后发送结束标记
//                    }
//                });
//
//    }

}
