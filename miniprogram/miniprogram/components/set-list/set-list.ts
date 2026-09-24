// components/set-list/set-list.ts
Component({

    /**
     * 组件的属性列表
     */
    properties: {

    },

    /**
     * 组件的初始数据
     */
    data: {

    },

    /**
     * 组件的方法列表
     */
    methods: {
        gotoLicenses(){ wx.navigateTo({ url: '/pages/my-licenses/my-licenses' }) },
        gotoUserinfo(){
            this.triggerEvent('gotoUserinfo')
        },
        gotoLogout(){
            this.triggerEvent('gotoLogout')
        },
        gotoCompany(){
            this.triggerEvent('gotoCompany')
        },
        gotoContactUs(){
            this.triggerEvent('gotoContactUs')
        }
    }
})
