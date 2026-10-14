package com.pango.controller;

import com.pango.entity.DtoLicenseApplication;
import com.pango.exception.GlobalExceptionHandler;
import com.pango.service.ServiceLicenseApplication;
import com.pango.service.ServiceLicensePortal;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class LicenseApplicationControllerTest {
    private MockMvc mvc;
    private ServiceLicensePortal portal;
    private ServiceLicenseApplication applications;
    private final String body = "{\"emailType\":\"ORGANIZATION\",\"userinfoId\":999,\"ownerVerified\":false,\"officialSubmitted\":true,\"operatingSystem\":\"Windows\",\"softwareVersion\":\"PDS2022.2\",\"licenseType\":\"STANDALONE\",\"durationYears\":1,\"macAddress\":\"AA-BB-CC-DD-EE-FF\",\"applicantName\":\"测试\",\"companyName\":\"测试公司\",\"email\":\"user@example.com\",\"phone\":\"13800000000\",\"address\":\"测试地址\"}";
    @BeforeEach void setup() {
        portal = mock(ServiceLicensePortal.class); applications = mock(ServiceLicenseApplication.class);
        ControllerLicenseApplication controller = new ControllerLicenseApplication();
        ReflectionTestUtils.setField(controller,"portal",portal);
        ReflectionTestUtils.setField(controller,"serviceLicenseApplication",applications);
        mvc = standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
    }
    @Test void submitUsesAuthenticatedOwnerAndAllowsOfficialSubmitted() throws Exception {
        when(portal.requireMember("Bearer member")).thenReturn(42L);
        mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(2000));
        ArgumentCaptor<DtoLicenseApplication> saved = ArgumentCaptor.forClass(DtoLicenseApplication.class);
        verify(applications).submit(saved.capture());
        assertEquals(42L,saved.getValue().getUserinfoId());
        assertTrue(saved.getValue().getOwnerVerified()); assertTrue(saved.getValue().getOfficialSubmitted());
    }
    @Test void personalEmailRequiresContactAndServerRequiresPositiveInteger() throws Exception {
        when(portal.requireMember("Bearer member")).thenReturn(42L);
        String personal = body.replace("ORGANIZATION", "PERSONAL");
        String server = body.replace("STANDALONE", "SERVER");
        for (String invalid : new String[]{personal, server, server.replace("{", "{\"maxUsers\":0,"), server.replace("{", "{\"maxUsers\":1.5,"), body.replace("\"emailType\":\"ORGANIZATION\",", "")}) {
            mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(invalid)).andExpect(jsonPath("$.code").value(4001));
        }
        verifyNoInteractions(applications);
        String valid = personal.replace("STANDALONE", "SERVER").replace("{", "{\"contactPerson\":\" 王工 \",\"maxUsers\":8,");
        mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(valid)).andExpect(jsonPath("$.code").value(2000));
        ArgumentCaptor<DtoLicenseApplication> saved = ArgumentCaptor.forClass(DtoLicenseApplication.class);
        verify(applications).submit(saved.capture());
        assertEquals("王工",saved.getValue().getContactPerson());assertEquals(8,saved.getValue().getMaxUsers());
    }
    @Test void standaloneDiscardsHiddenServerCapacity() throws Exception {
        when(portal.requireMember("Bearer member")).thenReturn(42L);
        mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(body.replace("{", "{\"maxUsers\":12,"))).andExpect(jsonPath("$.code").value(2000));
        ArgumentCaptor<DtoLicenseApplication> saved = ArgumentCaptor.forClass(DtoLicenseApplication.class);verify(applications).submit(saved.capture());assertNull(saved.getValue().getMaxUsers());
    }
    @Test void allEndpointsRequireLogin() throws Exception {
        when(portal.requireMember(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED,"请先登录后继续"));
        mvc.perform(post("/license/application/submit").contentType("application/json").content(body)).andExpect(status().isUnauthorized());
        mvc.perform(get("/license/application/mine")).andExpect(status().isUnauthorized());
        mvc.perform(get("/license/application/1/download")).andExpect(status().isUnauthorized());
        verifyNoInteractions(applications);
    }
    @org.springframework.web.bind.annotation.RestController
    static class ExistingController {
        @org.springframework.web.bind.annotation.GetMapping("/existing-error")
        public void error() { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "existing behavior"); }
    }
    @Test void licenseHttpMappingDoesNotChangeOtherControllers() throws Exception {
        MockMvc existing = standaloneSetup(new ExistingController()).setControllerAdvice(new GlobalExceptionHandler()).build();
        existing.perform(get("/existing-error")).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(4001));
    }

    @Test void officialSelectionRequiredAndInvalidMacRejected() throws Exception {
        when(portal.requireMember(anyString())).thenReturn(42L);
        mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(body.replace("\"officialSubmitted\":true,", ""))).andExpect(jsonPath("$.code").value(4001));
        mvc.perform(post("/license/application/submit").header("Authorization","Bearer member").contentType("application/json").content(body.replace("AA-BB-CC-DD-EE-FF","not-a-mac"))).andExpect(jsonPath("$.code").value(4001));
        verifyNoInteractions(applications);
    }
}
