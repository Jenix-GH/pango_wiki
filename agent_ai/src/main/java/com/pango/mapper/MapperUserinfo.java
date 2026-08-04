package com.pango.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.pango.entity.DtoUserinfo;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface MapperUserinfo extends BaseMapper<DtoUserinfo> {
    @Update("UPDATE dto_userinfo SET quota_used = quota_used + 1 " +
            "WHERE id = #{userId} AND user_type = 'GUEST' AND quota_used < #{quotaLimit}")
    int consumeGuestQuota(@Param("userId") long userId, @Param("quotaLimit") int quotaLimit);
}
