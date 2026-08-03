package com.pango.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoQuestionTemplate;
import com.pango.entity.DtoSet;
import com.pango.entity.DtoUserinfo;
import com.pango.mapper.MapperQuestionTemplate;
import com.pango.mapper.MapperUserinfo;
import org.springframework.context.annotation.Lazy;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

/**
 * 用户信息服务实现类
 */
@Transactional
@org.springframework.stereotype.Service
public class ServiceQuestionTemplate extends ServiceImpl<MapperQuestionTemplate, DtoQuestionTemplate> implements BaseService<DtoQuestionTemplate> {
    @Override
    public LambdaQueryWrapper<DtoQuestionTemplate> fillParams(Map<String, Object> params) {
        return null;
    }

    public List<DtoQuestionTemplate> getList(){
        return list();
    }




}
