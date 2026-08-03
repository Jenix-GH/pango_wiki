package com.pango.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

@Data
@TableName("dto_question_template")
@Accessors(chain = true)
public class DtoQuestionTemplate {

    private long id;
    private String question;

}
