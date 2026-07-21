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
        gotoUserinfo(){
            this.triggerEvent('gotoUserinfo')
        },
        gotoDataManager(){
            this.triggerEvent('gotoDataManager')
        },
        gotoCompany(){
            this.triggerEvent('gotoCompany')
        },
        gotoContactUs(){
            this.triggerEvent('gotoContactUs')
        }
    }
})