package com.pango.service;

import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LicensePortalTest {
    @Test void rejectsGuestsAndInvalidSessions() {
        ServiceAuth auth = mock(ServiceAuth.class);
        ServiceLicensePortal portal = new ServiceLicensePortal();
        ReflectionTestUtils.setField(portal,"auth",auth);
        when(auth.resolveUser("guest")).thenReturn(new DtoUserinfo().setId(1L).setUserType("GUEST"));
        when(auth.resolveUser("expired")).thenThrow(new MyException("expired"));
        when(auth.resolveUser("member")).thenReturn(new DtoUserinfo().setId(2L));
        assertThrows(ResponseStatusException.class,()->portal.requireMember("guest"));
        assertThrows(ResponseStatusException.class,()->portal.requireMember("expired"));
        assertEquals(2L,portal.requireMember("member"));
    }
}
