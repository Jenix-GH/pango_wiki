// components/user-protocol.ts
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
    showProtocol: false
  },

  /**
   * 组件的方法列表
   */
  methods: {
    showPanel() {
        this.setData({ showProtocol: true })
    },
    hidePanel(){
        this.setData({ showProtocol: false })
    }
  }
})