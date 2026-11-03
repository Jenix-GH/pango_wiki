package com.pango.service;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in only: fixed disposable database on local test port, never production configuration. */
@EnabledIfEnvironmentVariable(named="LICENSE_MYSQL_TEST", matches="1")
class LicensePortalMysqlTest {
    static JdbcTemplate db;
    ServiceLicensePortal portal;
    @BeforeAll static void migrate() throws Exception {
        db = new JdbcTemplate(new DriverManagerDataSource("jdbc:mysql://host.docker.internal:13316/pango_license_test?serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false", "root", "local-test-only"));
        assertEquals("pango_license_test", db.queryForObject("SELECT DATABASE()",String.class));
        Integer exists = db.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='dto_license_application' AND column_name='owner_verified'",Integer.class);
        if (exists == 0) {
            long before = db.queryForObject("SELECT COUNT(*) FROM dto_license_application",Long.class);
            db.execute(new String(Files.readAllBytes(Paths.get("database/migrations/20260924_license_portal.sql")),StandardCharsets.UTF_8));
            assertEquals(before, db.queryForObject("SELECT COUNT(*) FROM dto_license_application",Long.class));
            assertEquals(0L, db.queryForObject("SELECT COUNT(*) FROM dto_license_application WHERE owner_verified<>0 OR official_submitted IS NOT NULL",Long.class));
        }
    }
    @BeforeEach void setup() {
        for(String table: Arrays.asList("dto_license_file","dto_license_mail","dto_license_rejection","dto_license_application")) db.execute("TRUNCATE TABLE " + table);
        portal = new ServiceLicensePortal(); ReflectionTestUtils.setField(portal,"db",db);
        app(1,42,1,0); app(2,43,1,0); app(3,42,0,0);
    }
    void app(int id,int owner,int verified,int status) {
        db.update("INSERT INTO dto_license_application (id,userinfo_id,owner_verified,official_submitted,mac_address,email,applicant_name,company_name,operating_system,software_version,license_type,duration_years,status) VALUES (?,?,?,?,?,'user@example.com','测试','公司','Windows','PDS2022.2','STANDALONE',1,?)", id,owner,verified,true,String.format("AA-BB-CC-DD-EE-%02X",id),status);
    }
    void file(String id,String state) {
        db.update("INSERT INTO dto_license_file (id,batch_id,original_name,mac,sha256,byte_length,content,application_id,state,uploaded_by) " +
            "VALUES (?, 'test','example.lic','AABBCCDDEE01',SHA2('abcd',256),4,'abcd',1,?,'tester')",id,state);
    }
    void mail(int app,String kind,String key,String state,String detail,String file) {
        String id=UUID.randomUUID().toString();
        db.update("INSERT INTO dto_license_mail(id,dedupe_key,kind,application_id,file_id,recipient,subject,message_id,state,detail,attempts) " +
            "VALUES(?,?,?,?,?,'original@example.org','example',?,?,?,1)",id,key,kind,app,file,id,state,detail);
    }
    @SuppressWarnings("unchecked") List<Map<String,Object>> records(long user) { return (List<Map<String,Object>>)portal.list(user,1).get("records"); }
    Map<String,Object> first(){return records(42).get(0);}
    @SuppressWarnings("unchecked") Map<String,String> mailView(){return (Map<String,String>)first().get("mail");}
    void state(String expected){assertEquals(expected,mailView().get("state"));}
    @Test void verifiedOwnerOnlyAndNoDownloadMetadata() {
        assertEquals(1,records(42).size());assertEquals(1,records(43).size());assertTrue(records(99).isEmpty());
        assertEquals(true,first().get("officialSubmitted"));file("file1","queued");
        assertEquals(false,first().get("canDownload"));assertNull(first().get("filename"));assertFalse(first().containsKey("content"));
        mail(2,"customer","customer:2","accepted","","other-file");state("queued");
    }
    @Test void onlyActualCustomerAcceptanceIsSentRegardlessOfManualProgress() {
        mail(1,"digest","digest:2026-10-27","accepted","",null);state("not_sent");
        db.update("UPDATE dto_license_application SET status=2 WHERE id=1");state("no_record");
        file("file1","queued");state("queued");db.update("UPDATE dto_license_file SET state='accepted'");state("no_record");
        mail(1,"customer","customer:1","accepted","","file1");state("sent");
        assertTrue(mailView().get("note").contains("or***@example.org"));
        assertFalse(first().toString().contains("original@example.org"));
        db.update("UPDATE dto_license_application SET status=0,email='different@example.com' WHERE id=1");
        state("sent");assertEquals(0,((Number)first().get("status")).intValue());
    }
    @Test void distinguishRefusalFailureAndPartialDeliveryWithoutLeakingDiagnostics() {
        file("file1","failed");mail(1,"customer","customer:1","failed","收件地址被拒收：主收件人 original@example.org：SMTP 550 5.1.1","file1");state("refused");
        db.update("UPDATE dto_license_mail SET detail='发信准备或连接失败：TimeoutError'");state("failed");
        db.update("UPDATE dto_license_mail SET state='unknown',detail='部分收件地址被拒收：抄送 private@example.org'");state("unknown");
        assertFalse(first().toString().contains("private@example.org"));
        db.update("UPDATE dto_license_mail SET state='sending'");state("sending");
    }
    @Test void currentRejectionCycleOnlyAndReasonPreserved() {
        db.update("UPDATE dto_license_application SET status=3 WHERE id=1");
        db.update("INSERT INTO dto_license_rejection(application_id,reason,recipient,application_snapshot,state,requested_by) VALUES (1,'资料不足','user@example.com','{}','queued','tester')");
        mail(1,"customer","customer:1","accepted","","old-file");
        mail(1,"rejection","rejection-archived:old","accepted","",null);state("queued");
        assertEquals("资料不足",first().get("rejectionReason"));
        db.update("UPDATE dto_license_rejection SET state='cancelled'");state("stopped");
        db.update("UPDATE dto_license_rejection SET state='queued'");mail(1,"rejection","rejection:1","accepted","",null);
        state("sent");assertEquals("拒绝说明已发送至邮箱",mailView().get("label"));
    }
    @Test void replacementFileDoesNotInheritFailedOldFileAndFloatingDetailsRemain() {
        db.update("UPDATE dto_license_application SET license_type='SERVER',email_type='PERSONAL',contact_person='王工',max_users=12 WHERE id=1");
        file("old","cancelled");mail(1,"customer","customer:1","failed","收件地址被拒收：主收件人","old");file("new","queued");state("queued");
        assertEquals(12,((Number)first().get("maxUsers")).intValue());assertEquals("王工",first().get("contactPerson"));
        db.update("UPDATE dto_license_file SET state='paused' WHERE id='new'");state("stopped");
    }
}
