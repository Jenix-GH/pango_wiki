package com.pango.utils;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.concurrent.TimeUnit;

/**
 * Redis工具类
 */
@Component
public class UtilsRedis {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    // 字符串操作
    public void set(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
    }

    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    // 哈希操作
    public void hSet(String key, String field, Object value) {
        redisTemplate.opsForHash().put(key, field, value);
    }

    public Object hGet(String key, String field) {
        return redisTemplate.opsForHash().get(key, field);
    }

    // 列表操作
    public void lPush(String key, Object value) {
        redisTemplate.opsForList().leftPush(key, value);
    }

    // 设置过期时间
    public boolean expire(String key, long time) {
        return redisTemplate.expire(key, time, TimeUnit.SECONDS);
    }

    // 删除key
    public boolean delete(String key) {
        return redisTemplate.delete(key);
    }

}
