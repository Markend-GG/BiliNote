import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import toast from 'react-hot-toast'

// 统一响应类型
export interface IResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

/**
 * 网络层失败时 reject 出来的对象。除了 { code, msg, data } 还带上"失败性质"，
 * 因为调用方必须能区分：
 *   - 超时（isTimeout）：请求可能已经送达、服务端可能已经在干活了 → 结果是"未知"，不是"失败"
 *   - 连不上（status 为空）：请求根本没到服务端 → 可以安全重发
 * 以前一律压成 "请求失败，请检查网络连接"，轮询把超时当成任务 FAILED，
 * 界面显示生成失败而后端还在跑，用户再点一次就多烧一遍 API 额度。
 */
export interface RequestFailure extends IResponse<null> {
  /** 客户端超时（axios ECONNABORTED）：服务端可能已经收到并在执行 */
  isTimeout?: boolean
  /** HTTP 状态码；连不上/超时时为 undefined */
  status?: number
}

// 允许调用方在 axios 配置里带 suppressToast: true，让拦截器对【预期内的失败】
// 不弹全局红 toast（例如 onboarding 撞名重试、轮询健康检查）。业务代码自己 catch 处理。
declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressToast?: boolean
  }
}

// 模拟一个消息提示函数 (实际项目中会使用UI库的组件，如 Ant Design 的 message 或 Element UI 的 ElMessage)
// This function simulates a message display (in real projects, you'd use a UI library's component)

const baseURL = import.meta.env.VITE_API_BASE_URL;

// 创建实例
 const request: AxiosInstance = axios.create({
  baseURL: baseURL || '/api',
  timeout: 10000,
});

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse<IResponse>) => {
    const res = response.data;
    if (res.code === 0) {
      // 业务成功，可以根据需要显示成功消息，或者不显示（如果操作本身就是可见的）
      // showMessage('success', res.msg || '操作成功'); // 如果需要显示成功消息
      return res.data; // 返回data部分，简化后续业务代码
    } else {
      // 业务错误，统一显示后端返回的错误消息（除非调用方显式 suppressToast）
      if (!response.config?.suppressToast) {
        toast.error(res.msg || '操作失败，请稍后再试');
      }
      return Promise.reject(res); // 拒绝Promise，让业务代码可以捕获并处理
    }
  },
  (error) => {
    const suppress = error?.config?.suppressToast === true
    // 网络/服务器错误
    const res = error?.response?.data as IResponse | undefined;
    if (res) {
      // 如果后端有返回错误信息，则显示后端信息
      if (!suppress) toast.error(res.msg || '服务器错误，请稍后再试');
      return Promise.reject({ ...res, status: error.response.status } as RequestFailure);
    }
    const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message ?? ''))
    if (!suppress) {
      toast.error(isTimeout ? '请求超时，服务端可能仍在处理' : '请求失败，请检查网络连接或稍后再试')
    }
    return Promise.reject({
      code: -1,
      msg: isTimeout ? '请求超时' : '请求失败，请检查网络连接',
      data: null,
      isTimeout,
      status: undefined,
    } as RequestFailure);
  }
);

/**
 * 响应拦截器已经把 { code, msg, data } 解包成 data 本身，但 axios 的类型签名不知道这件事，
 * 于是所有调用方拿到的类型都是 AxiosResponse，取 .models / .result 全报错（存量 30+ 条）。
 * 这里把四个动词的返回类型改成"解包后的 payload"：第二个泛型参数即业务数据类型，
 * 不传就是 any（兼容存量调用），传了就有提示。
 */
export interface UnwrappedRequest {
  get: <T = any, R = T>(url: string, config?: AxiosRequestConfig) => Promise<R>
  post: <T = any, R = T>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<R>
  patch: <T = any, R = T>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<R>
  put: <T = any, R = T>(url: string, data?: any, config?: AxiosRequestConfig) => Promise<R>
  delete: <T = any, R = T>(url: string, config?: AxiosRequestConfig) => Promise<R>
}

export default request as unknown as UnwrappedRequest
