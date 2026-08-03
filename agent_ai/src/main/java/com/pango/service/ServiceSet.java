package com.pango.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoSet;
import com.pango.mapper.MapperSet;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 设置信息
 */
@Transactional
@Service
@Slf4j
public class ServiceSet extends ServiceImpl<MapperSet, DtoSet> implements BaseService<DtoSet> {
    @Override
    public LambdaQueryWrapper<DtoSet> fillParams(Map<String, Object> params) {
        return null;
    }

    /**
     * 设置数据使用权限
     * @param obj DtoSet
     */
    public synchronized DtoSet doUpdateFlagUseData(DtoSet obj){
        DtoSet set = findCheckById(Math.toIntExact(obj.getId()), true);
        if(!Objects.equals(set.getUserinfoId(), obj.getUserinfoId())){
            return obj;
        }
        DtoSet upObj = new DtoSet().setId(obj.getId())
                .setDataUseFlag(obj.getDataUseFlag())
                .setUserinfoId(obj.getUserinfoId());
        this.updateById(upObj);
        return upObj;
    }

    /**
     * 取得当前用户的设置数据
     * @param userId 用户ID
     */
    public DtoSet findByUserId(int userId){
        LambdaQueryWrapper<DtoSet> qw = loadQw();
        qw.eq(DtoSet::getUserinfoId, userId);
        List<DtoSet> list = this.list(qw);
        if(CollectionUtils.isEmpty(list)){
            return null;
        }
        return list.get(0);
    }

}
