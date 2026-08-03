package com.pango.service;

import com.pango.utils.UtilsRedis;
import com.pango.vo.VoWxAccessToken;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.Assert;
import org.springframework.web.client.RestTemplate;
import javax.annotation.Resource;
import java.util.HashMap;
import java.util.Map;

/**
 * 微信的相关服务
 */
@Service
@Transactional
@Slf4j
public class ServiceWx {

    @Resource
    private RestTemplate restTemplate;

    @Value("${wx.appid}")
    private String appid;
    @Value("${wx.secret}")
    private String secret;
    @Resource
    private UtilsRedis utilsRedis;

    /**
     * 解析手机号
     * @param code 用户信息获取成功后返回的code
     * @return 手机号
     */
    public String decryptPhone(String code) {
        String accessToken = getAccessToken();
        // 微信API地址
        String url = "https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=" + accessToken;
        // 准备请求参数
        Map<String, String> params = new HashMap<>();
        params.put("code", code);
        // 发送POST请求
        Map<String, Object> response = restTemplate.postForObject(url, params, Map.class);
        log.info("response>>>>>>>: ");
        log.info(response.toString());
        // 解析响应获取手机号
        if (response != null && response.containsKey("phone_info")) {
            Map<String, Object> phoneInfo = (Map<String, Object>) response.get("phone_info");
            return (String) phoneInfo.get("purePhoneNumber");
        }
        return "";
    }

    /**
     * 获取access_token
     * @return access_token
     */
    public String getAccessToken(){
        String appid = "wxafd59b2bb3a66e06";
        String secret = "4c0dc70d46cc9ec37d54a6ed301ddd4f";
        //获取redis缓存
        Object object = utilsRedis.get("pango_access_token");
        if(null != object){
            return (String) object;
        }
        String url = "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=" + appid + "&secret=" + secret;
        VoWxAccessToken voWxAccessToken = restTemplate.getForObject(url, VoWxAccessToken.class);
        log.info(voWxAccessToken.toString());
        //存储到redis中
        Assert.state(null != voWxAccessToken, "获取AccessToken时解析对象出错-1");
        utilsRedis.set("pango_access_token",voWxAccessToken.getAccess_token());
        utilsRedis.expire("pango_access_token",voWxAccessToken.getExpires_in());
        return voWxAccessToken.getAccess_token();
    }

}
