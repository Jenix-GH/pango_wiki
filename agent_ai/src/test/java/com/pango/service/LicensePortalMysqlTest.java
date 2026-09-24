package com.pango.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
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
    void file(int id) throws Exception {
        Map<String,Object> row=db.queryForMap("SELECT * FROM dto_license_application WHERE id=?",id);
        Map<String,String> snapshot=new LinkedHashMap<>();
        for(String key:Arrays.asList("id","mac_address","email","operating_system","software_version","license_type","duration_years","applicant_name","company_name"))snapshot.put(key,String.valueOf(row.get(key)));
        String mac=String.valueOf(row.get("mac_address")).replace("-","");
        db.update("INSERT INTO dto_license_file (id,batch_id,original_name,mac,sha256,byte_length,content,application_id,application_snapshot,state,uploaded_by) VALUES (?, 'batch',?,?,SHA2('test license',256),12,?,?,?,'queued','tester')",
                "file-"+id,"new_pds_"+mac+".lic",mac,"test license".getBytes(StandardCharsets.UTF_8),id,new ObjectMapper().writeValueAsString(snapshot));
    }
    @SuppressWarnings("unchecked") List<Map<String,Object>> records(long user) { return (List<Map<String,Object>>)portal.list(user,1).get("records"); }
    boolean available() { return Boolean.TRUE.equals(records(42).get(0).get("canDownload")); }
    @Test void onlyVerifiedOwnRecordsVisible() {
        assertEquals(1,records(42).size()); assertEquals(1,records(43).size()); assertTrue(records(99).isEmpty());
        assertEquals(true,records(42).get(0).get("officialSubmitted"));
        assertThrows(ResponseStatusException.class,()->portal.download(42,2));
        assertThrows(ResponseStatusException.class,()->portal.download(42,3));
    }
    @Test void uniqueUploadDownloadAvailableBeforeEmailAndIndependentOfManualStatus() throws Exception {
        file(1); assertTrue(available());
        for(int status:Arrays.asList(0,1,2)) {
            db.update("UPDATE dto_license_application SET status=? WHERE id=1",status);
            assertArrayEquals("test license".getBytes(StandardCharsets.UTF_8),portal.download(42,1).getBody());
        }
        assertEquals("no-store, private",portal.download(42,1).getHeaders().getFirst("Cache-Control"));
    }
    @Test void manualProcessedWithoutFileDoesNotOfferDownload() {
        db.update("UPDATE dto_license_application SET status=2 WHERE id=1"); assertFalse(available());
        assertThrows(ResponseStatusException.class,()->portal.download(42,1));
    }
    @Test void rejectedAndBlockedFilesCannotDownload() throws Exception {
        file(1);
        for(String state:Arrays.asList("conflict","unmatched","cancelled","duplicate","paused","sending","unknown")) {
            db.update("UPDATE dto_license_file SET state=?",state); assertFalse(available());
            assertThrows(ResponseStatusException.class,()->portal.download(42,1));
        }
        db.update("UPDATE dto_license_file SET state='queued'"); db.update("UPDATE dto_license_application SET status=3 WHERE id=1");
        assertFalse(available()); assertThrows(ResponseStatusException.class,()->portal.download(42,1));
    }
    @Test void changedApplicationAndCorruptContentBlocked() throws Exception {
        file(1); db.update("UPDATE dto_license_application SET email='changed@example.com' WHERE id=1");
        assertFalse(available()); assertThrows(ResponseStatusException.class,()->portal.download(42,1));
        db.update("UPDATE dto_license_application SET email='user@example.com' WHERE id=1");
        db.update("UPDATE dto_license_file SET content='bad content!'");
        assertThrows(ResponseStatusException.class,()->portal.download(42,1));
    }
    @Test void laterMacAmbiguityBlockedUnlessManuallyConfirmed() throws Exception {
        file(1); db.update("UPDATE dto_license_application SET mac_address='AA-BB-CC-DD-EE-01' WHERE id=2");
        assertFalse(available()); db.update("UPDATE dto_license_file SET manual_selection=1"); assertTrue(available());
    }
    @Test void acceptedLicenseRemainsDownloadable() throws Exception {
        file(1); db.update("UPDATE dto_license_file SET state='accepted'"); assertTrue(available());
    }
}
