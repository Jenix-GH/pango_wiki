package com.pango.service;

import com.alibaba.fastjson.JSONArray;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoAnswer;
import com.pango.entity.DtoQuestion;
import com.pango.entity.DtoUserinfo;
import com.pango.mapper.MapperAnswer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Collections;

/**
 * 对话的回答记录
 */
@Transactional
@Service
@Slf4j
public class ServiceAnswer extends ServiceImpl<MapperAnswer, DtoAnswer> implements BaseService<DtoAnswer> {
    @Override
    public LambdaQueryWrapper<DtoAnswer> fillParams(Map<String, Object> params) {
        return null;
    }

    @Resource
    private ServiceQuestion serviceQuestion;
    @Resource
    private ServiceUserinfo serviceUserinfo;

    /**
     * 保存回答
     * @param obj DtoAnswer
     */
    public void doAdd(DtoAnswer obj){
        validateAnswerMedia(obj.getAnswerMedia());
        //先获取当前用户的最后一条问题
        DtoQuestion question = serviceQuestion.findByLast(Math.toIntExact(obj.getUserinfoId()));
        if(question != null){
            obj.setQuestionId(question.getId()).setQuestionEnd(question.getDotime());
            this.save(obj);
        }
    }

    /**
     * 根据问题ID获取回答记录
     * @param questionId 问题ID
     * @param userinfoId 用户ID
     * @return DtoAnswer
     */
    public DtoAnswer getByQuestionId(long questionId, long userinfoId){
        LambdaQueryWrapper<DtoAnswer> qw = loadQw();
        qw.eq(DtoAnswer::getQuestionId, questionId)
                .eq(DtoAnswer::getUserinfoId, userinfoId);
        List<DtoAnswer> list = this.list(qw);
        if(CollectionUtils.isEmpty(list)){
            return null;
        }
        return list.get(0);
    }

    private void validateAnswerMedia(String answerMedia) {
        if (answerMedia == null || answerMedia.trim().isEmpty()) {
            return;
        }
        if (answerMedia.length() > 65535) {
            throw new com.pango.exception.MyException("回答图片数据过大");
        }
        try {
            JSONArray media = JSONArray.parseArray(answerMedia);
            if (media.size() > 10) {
                throw new com.pango.exception.MyException("回答图片最多保存10张");
            }
        } catch (com.pango.exception.MyException e) {
            throw e;
        } catch (Exception e) {
            throw new com.pango.exception.MyException("回答图片数据格式不正确");
        }
    }

    public List<DtoAnswer> getByQuestionIds(List<Long> questionIds, long userinfoId) {
        if (questionIds == null || questionIds.isEmpty()) return Collections.emptyList();
        LambdaQueryWrapper<DtoAnswer> qw = loadQw();
        qw.eq(DtoAnswer::getUserinfoId, userinfoId)
                .in(DtoAnswer::getQuestionId, questionIds)
                .orderByAsc(DtoAnswer::getId);
        return this.list(qw);
    }

    /**
     * 用户评价回答内容
     * @param userinfoId 用户iD
     * @param answerTime 回答时间
     * @param evaluate 评价值
     */
    public void doEvaluate(int userinfoId, String answerTime, int evaluate){
        log.info(userinfoId + "");
        log.info(answerTime);
        log.info(evaluate + "");
        LambdaQueryWrapper<DtoAnswer> qw = loadQw();
        qw.eq(DtoAnswer::getUserinfoId, userinfoId)
                .eq(DtoAnswer::getAnswerTime, answerTime);
        List<DtoAnswer> list = this.list(qw);
        if(!CollectionUtils.isEmpty(list)){
            for(DtoAnswer item : list){
                item.setFlagEvaluate(evaluate);
            }
            this.updateBatchById(list);
        }
    }

    /**
     * 获取用户回答数量
     * @param userinfoId 用户ID
     * @return  数量
     */
    public long getCount(int userinfoId){
        LambdaQueryWrapper<DtoAnswer> qw = loadQw();
        qw.eq(DtoAnswer::getUserinfoId, userinfoId);
        return this.count(qw);
    }



}
