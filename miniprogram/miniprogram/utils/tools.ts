//复制内容到粘贴板
export const copyToClipboard = (content: string) => {
    return wx.setClipboardData({
        data: content,
        success: () => wx.showToast({ title: '复制成功', icon: 'success' }),
        fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
}

//递归得到markdonw的文本
export const extractText = (node: any) => {
    if (typeof node === 'string') return node;
    if (node.text) return node.text;
    if (node.children) {
        return node.children.map(extractText).join('');
    }
    return '';
}

export const showSuccess = (content: string) => {
    if (content === "") {
        content = "操作完成";
    }
    wx.showToast({
        "title": content,
        icon: "success"
    })
}

export const showError = (content: string) => {
    wx.showToast({
        "title": content,
        icon: "none"
    })
}

export const sanitizeUserInfo = (user: any) => {
    if (!user) return user
    const safe = { ...user }
    delete safe.todayQuestionList
    delete safe.weekQuestionList
    return safe
}

export const persistUserInfo = (user: any) => {
    const safe = sanitizeUserInfo(user)
    wx.setStorageSync('userInfo', safe)
    return safe
}
