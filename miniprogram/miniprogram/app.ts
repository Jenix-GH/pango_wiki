// app.ts
interface IAppOption {
    globalData: Record<string, any>
}
App<IAppOption>({
    globalData: {
        loginCode: '',
        userInfo: null,
        baseHost: "https://aiapp.pangomicro.com/dbServ",
        qaHost: "https://aiapp.pangomicro.com",
        sessionUrl: "https://aiapp.pangomicro.com/dbServ/dialogue/stream-answer",
        conversationId:"bdc39a5e6ce011f0904caecf82960528",
        sessionUrl_choose: "https://aiapp.pangomicro.com/dbServ/dialogue/stream-answer",
        referenceHost: "https://aiapp.pangomicro.com",
        conversationId_choose:"e1e6b710fdc511f0ab0372b9cdc2d76f",
        authorization: "Bearer test",
        question: "你是谁？",
        quote: true,
        sessionId: '',
        answerLimitMax: 50, //免费的最大回答条数
        flagCompanyInfo: false, //公司信息完善标识，false没有，true已完善
        flagLogin: false //授权标识
    },
    onLaunch() {
        // 展示本地存储能力

    },
})
