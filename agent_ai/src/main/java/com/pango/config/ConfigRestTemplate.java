package com.pango.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

/**
 * Created by pango on 05/05/2017.
 * RestTemplate Config
 */
@Configuration
public class ConfigRestTemplate {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

}
