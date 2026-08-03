package com.pango.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoQuestion;
import com.pango.mapper.MapperQuestion;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * 对话的问题记录
 */
@Transactional
@Service
@Slf4j
public class ServiceQuestion extends ServiceImpl<MapperQuestion, DtoQuestion> implements BaseService<DtoQuestion> {
    @Override
    public LambdaQueryWrapper<DtoQuestion> fillParams(Map<String, Object> params) {
        return null;
    }

    /**
     * 保存问题
     * @param obj DtoQuestion
     */
    public void doAdd(DtoQuestion obj){
        String today = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
        obj.setDoDate(today);
        this.save(obj);
    }

    /**
     * 获取用户下当天和当周的问题
     * @param userId 用户ID
     */
    public DtoQuestion findHisByUserId(int userId){
        // 查询用户下当天的问题
        String today = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
        LambdaQueryWrapper<DtoQuestion> qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0)
                .eq(DtoQuestion::getDoDate, today)
                .orderByDesc(DtoQuestion::getId);
        List<DtoQuestion> todayList = this.list(qw);
        // 查询用户下当周的问题
        Calendar calendar = Calendar.getInstance(); // 昨天日期
        calendar.add(Calendar.DATE, -1);
        Date yesterday = calendar.getTime();
        String weekEnd = new SimpleDateFormat("yyyy-MM-dd").format(yesterday);
        calendar = Calendar.getInstance(); // 昨天前第7天的日期
        calendar.add(Calendar.DATE, -8);
        Date beforeWeekDay = calendar.getTime();
        String weekStart = new SimpleDateFormat("yyyy-MM-dd").format(beforeWeekDay);
        qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0)
                .between(DtoQuestion::getDoDate, weekStart, weekEnd)
                .orderByDesc(DtoQuestion::getId);
        List<DtoQuestion> weekList = this.list(qw);
        return new DtoQuestion().setTodayQuestion(todayList).setWeekQuestion(weekList);
    }

    /**
     * 单独获取用户当天的问题清单
     * @param userId 用户ID
     * @return DtoQuestion
     */
    public DtoQuestion findTodayByUserId(int userId){
        // 查询用户下当天的问题
        String today = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
        LambdaQueryWrapper<DtoQuestion> qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0)
                .eq(DtoQuestion::getDoDate, today)
                .orderByDesc(DtoQuestion::getId);
        List<DtoQuestion> todayList = this.list(qw);
        return new DtoQuestion().setTodayQuestion(todayList);
    }

    /**
     * 删除用户下所有记录
     * @param userId 用户ID
     */
    public void doRemoveHis(int userId){
        // 查询需要软删除的记录
        LambdaQueryWrapper<DtoQuestion> qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0);
        //执行软删除，将flagDel字段置为1
        this.update(new DtoQuestion().setFlagDel(1), qw);
    }

    /**
     * 获取用户下最后一条记录
     * @param userId 用户iD
     */
    public DtoQuestion findByLast(int userId){
        LambdaQueryWrapper<DtoQuestion> qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0)
                .orderByDesc(DtoQuestion::getId)
                .last("limit 1");
        return this.getOne(qw);
    }

}
