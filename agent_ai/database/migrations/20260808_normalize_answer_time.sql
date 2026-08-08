-- Java briefly stored answer_time as HH:mm:ss. Restore the historical
-- yyyy/MM/dd HH:mm:ss format using the authoritative answer creation time.
UPDATE `dto_answer`
SET `answer_time` = DATE_FORMAT(`dotime`, '%Y/%m/%d %H:%i:%s')
WHERE `answer_time` REGEXP '^[0-9]{2}:[0-9]{2}:[0-9]{2}$';

-- Repair question_end for answers created while the database-generated
-- question timestamp was not returned to the Java entity after INSERT.
UPDATE `dto_answer` AS a
INNER JOIN `dto_question` AS q ON q.`id` = a.`question_id`
SET a.`question_end` = q.`dotime`
WHERE a.`question_end` IS NULL;
