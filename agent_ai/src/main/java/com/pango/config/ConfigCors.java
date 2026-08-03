package com.pango.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ConfigCors implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")      // 所有接口
                .allowedOriginPatterns("*") // 允许的源
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")        // 允许的方法
                .allowedHeaders("*")              // 允许的请求头
                .allowCredentials(true)          // 允许携带凭证（cookie）
                .maxAge(3600);                  // 预检请求缓存时间（秒）
    }
}
