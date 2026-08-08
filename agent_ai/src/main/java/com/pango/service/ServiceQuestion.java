package com.pango.service;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoQuestion;
import com.pango.exception.MyException;
import com.pango.mapper.MapperQuestion;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Set;

/**
 * 对话的问题记录
 */
@Transactional
@Service
@Slf4j
public class ServiceQuestion extends ServiceImpl<MapperQuestion, DtoQuestion> implements BaseService<DtoQuestion> {
    private static final int MAX_QUESTION_IMAGE_COUNT = 1;
    private static final long MAX_QUESTION_IMAGE_BYTES = 15L * 1024 * 1024;
    // 15 MiB binary data expands to 20 MiB after Base64 encoding.
    private static final int MAX_QUESTION_IMAGE_JSON_CHARS = 22 * 1024 * 1024;

    @Override
    public LambdaQueryWrapper<DtoQuestion> fillParams(Map<String, Object> params) {
        return null;
    }

    /**
     * 保存问题
     * @param obj DtoQuestion
     */
    public void doAdd(DtoQuestion obj){
        validateQuestionImages(obj.getQuestionImages());
        String today = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
        obj.setDoDate(today);
        if (obj.getDotime() == null) obj.setDotime(new Date());
        this.save(obj);
    }

    private void validateQuestionImages(String questionImages) {
        if (questionImages == null || questionImages.trim().isEmpty()) return;
        if (questionImages.length() > MAX_QUESTION_IMAGE_JSON_CHARS) {
            throw new MyException("问题图片数据过大");
        }
        try {
            JSONArray images = JSONArray.parseArray(questionImages);
            if (images.size() > MAX_QUESTION_IMAGE_COUNT) {
                throw new MyException("每次只能上传1张图片");
            }
            long totalBytes = 0;
            for (int index = 0; index < images.size(); index++) {
                JSONObject image = images.getJSONObject(index);
                if (image == null) {
                    throw new MyException("问题图片数据格式错误");
                }
                String mimeType = image.getString("mime_type");
                String dataBase64 = image.getString("data_base64");
                if (mimeType == null || !mimeType.toLowerCase().startsWith("image/")
                        || dataBase64 == null || dataBase64.isEmpty()) {
                    throw new MyException("问题图片数据格式错误");
                }
                totalBytes += decodedBase64Size(dataBase64);
                if (totalBytes > MAX_QUESTION_IMAGE_BYTES) {
                    throw new MyException("上传图片大小不能超过15MB");
                }
            }
        } catch (MyException error) {
            throw error;
        } catch (Exception error) {
            throw new MyException("问题图片数据格式错误");
        }
    }

    private long decodedBase64Size(String value) {
        int length = value.length();
        if (length == 0 || length % 4 != 0) {
            throw new MyException("问题图片Base64格式错误");
        }
        int padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
        int contentLength = length - padding;
        for (int index = 0; index < contentLength; index++) {
            char current = value.charAt(index);
            boolean valid = current >= 'A' && current <= 'Z'
                    || current >= 'a' && current <= 'z'
                    || current >= '0' && current <= '9'
                    || current == '+' || current == '/';
            if (!valid) {
                throw new MyException("问题图片Base64格式错误");
            }
        }
        for (int index = contentLength; index < length; index++) {
            if (value.charAt(index) != '=') {
                throw new MyException("问题图片Base64格式错误");
            }
        }
        return (long) length / 4 * 3 - padding;
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
        List<DtoQuestion> todayList = groupBySession(this.list(qw));
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
        List<DtoQuestion> weekList = groupBySession(this.list(qw));
        Set<String> todaySessionIds = todayList.stream()
                .map(DtoQuestion::getSessionId)
                .filter(sessionId -> sessionId != null && !sessionId.startsWith("legacy_"))
                .collect(java.util.stream.Collectors.toCollection(HashSet::new));
        weekList.removeIf(question -> todaySessionIds.contains(question.getSessionId()));
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
        List<DtoQuestion> todayList = groupBySession(this.list(qw));
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

    public List<DtoQuestion> findSession(int userId, String sessionId) {
        LambdaQueryWrapper<DtoQuestion> qw = loadQw();
        qw.eq(DtoQuestion::getUserinfoId, userId)
                .eq(DtoQuestion::getFlagDel, 0)
                .eq(DtoQuestion::getSessionId, sessionId)
                .orderByAsc(DtoQuestion::getId);
        return this.list(qw);
    }

    private List<DtoQuestion> groupBySession(List<DtoQuestion> questions) {
        Map<String, List<DtoQuestion>> groups = new LinkedHashMap<>();
        for (DtoQuestion question : questions) {
            String key = question.getSessionId() == null || question.getSessionId().trim().isEmpty()
                    ? "legacy_" + question.getId() : question.getSessionId();
            groups.computeIfAbsent(key, ignored -> new ArrayList<>()).add(question);
        }
        List<DtoQuestion> summaries = new ArrayList<>();
        for (Map.Entry<String, List<DtoQuestion>> entry : groups.entrySet()) {
            List<DtoQuestion> sessionQuestions = entry.getValue();
            DtoQuestion latest = sessionQuestions.get(0);
            DtoQuestion first = sessionQuestions.get(sessionQuestions.size() - 1);
            latest.setQuestion(first.getQuestion());
            if (latest.getSessionId() == null || latest.getSessionId().trim().isEmpty()) {
                latest.setSessionId(entry.getKey());
            }
            summaries.add(latest);
        }
        return summaries;
    }

}
