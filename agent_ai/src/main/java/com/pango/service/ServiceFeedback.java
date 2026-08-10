package com.pango.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoFeedback;
import com.pango.mapper.MapperFeedback;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

@Service
@Transactional
public class ServiceFeedback extends ServiceImpl<MapperFeedback, DtoFeedback> {

    public DtoFeedback submit(DtoFeedback feedback) {
        Date now = new Date();
        feedback.setId(null)
                .setStatus(0)
                // Processing progress is an administrator-only field.
                .setProcessingProgress(null)
                .setDotime(now)
                .setUptime(now);
        save(feedback);
        return new DtoFeedback().setId(feedback.getId()).setStatus(feedback.getStatus());
    }
}
