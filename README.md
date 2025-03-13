# Anemone Backend

Anemone 后端服务，提供 Agent 管理和与 Phala Cloud 的交互。

## 架构概述

- **后端服务 (Anemone-backend)**: 处理 Agent 创建、技能管理和 CVM 部署请求
- **Agent CVM**: 运行在 Phala Cloud 上的可信容器，存储私钥并处理交易签名
- **CVM池管理**: 预先部署和管理CVM实例，为Agent创建提供实时可用CVM

## 环境设置

1. 复制环境变量示例文件:

```bash
cp .env.example .env
```

2. 在 `.env` 文件中设置您的配置

## 安装依赖

```bash
npm install
```

## 运行服务

```bash
npm start
```

服务将在端口 3000 上运行 (可通过 `.env` 文件配置)。

## CVM池管理

系统维护一个可用的CVM池，用于创建新的Agent。流程如下：

1. 使用管理API或手动方式在数据库中添加Phala账户
2. 管理员添加API Key到账户（可通过API或直接在数据库中设置）
3. 系统使用有API Key的账户部署CVM
4. 创建Agent时从池中获取可用CVM

### 自动维护池

系统在启动时会自动检查CVM池状态：
- 检查已部署CVM数量是否达到目标值（10个）
- 如果不足，系统会自动尝试部署更多CVM
- 如果没有足够的已配置API Key的账户，系统会记录日志但不报错
- 部署过程在后台进行，不会阻塞服务启动

### CVM部署监控

系统对CVM部署过程进行全面监控：
- 当部署请求发送后，账户状态会从`ready`转为`deploying`（部署中）
- 系统使用Phala Cloud SDK监控部署进度，每10秒检查一次状态
- 部署成功后，系统会自动获取CVM的网络信息并保存endpoint
- 部署失败或超时，系统会自动重置账户状态以备重试
- 所有状态变化都有详细日志记录，便于问题排查

### CVM Endpoint管理

系统通过以下方式管理CVM Endpoint：
- 部署完成后，使用PhalaCloud SDK的`getCvmNetwork`方法获取网络信息
- 从返回的`public_urls`数组中提取`app`字段作为endpoint
- 该endpoint用于后续与CVM实例通信，执行交易签名等操作
- endpoint保存在`phala_accounts`表的`cvm_endpoint`字段中
- Agent创建时，会从池中获取可用CVM并使用其endpoint

### CVM钱包地址管理

每个CVM实例都会自动创建并管理一个SUI钱包：
- CVM部署成功后，系统会通过CVM的`/wallet`接口获取钱包地址
- 接口返回格式：`{"success":true,"address":"0x钱包地址","created_at":"时间戳"}`
- 系统提取`address`字段并将其存储在`phala_accounts`表的`cvm_address`字段中
- 这个地址会在创建Agent时分配给Agent使用
- 所有交易由CVM内部的私钥签名，保证了私钥的安全性

### CVM App ID管理

系统将Phala Cloud的App ID贯穿整个生命周期：
- 部署CVM后，Phala Cloud返回的app_id存储在`phala_accounts`表中
- 创建Agent时，app_id会从数据库传递到Agent记录中
- 在链上创建Role对象时，app_id会作为参数传入并存储在链上
- 这确保了从云部署到链上角色的完整可追踪性
- app_id字段可用于跨平台集成和问题诊断

### CVM状态流转

账户有以下状态:
- `ready`: 账户已创建，可能已有API Key但尚未部署CVM
- `deploying`: 账户正在部署CVM，部署请求已发送但尚未完成
- `deployed`: CVM已成功部署且可用，等待分配给Agent
- `in_use`: CVM已分配给某个Agent使用

## API 端点

### Agent 管理

- `POST /create-agent` - 创建新 Agent（自动从CVM池获取地址）
  
  请求体:
  ```json
  {
    "role_id": "role123",
    "nft_id": "nft456"
  }
  ```

- `GET /agents` - 获取所有 Agents
- `GET /agent/nft-id/:role_id` - 通过 Role ID 获取 NFT ID

### 技能管理

- `GET /skills` - 获取所有技能
- `POST /skill` - 添加新技能
- `GET /skill/:id` - 通过 ID 获取技能
- `DELETE /skill/:object_id` - 删除技能

### CVM 部署

- `POST /deploy-cvm` - 手动部署新的 Agent CVM 实例
  
  请求体:
  ```json
  {
    "name": "agent-cvm-instance-name"  // 可选，不提供则自动生成
  }
  ```

- `GET /cvm/available` - 获取一个可用的CVM（用于创建Agent）
- `GET /cvm/pool-status` - 获取CVM池状态
- `POST /cvm/maintain-pool` - 维护CVM池大小
  
  请求体:
  ```json
  {
    "count": 3  // 尝试部署的CVM数量，最大10个
  }
  ```

### 管理员功能

- `POST /admin/phala-accounts` - 创建新的Phala账户
  
  请求体:
  ```json
  {
    "username": "custom-account-name",
    "password": "secure-password"
  }
  ```

- `POST /admin/update-api-key` - 更新Phala账户的API Key
  
  请求体:
  ```json
  {
    "account_id": 1,
    "api_key": "your-phala-api-key"
  }
  ```

- `GET /admin/phala-accounts` - 列出所有Phala账户

## 架构变更说明

- 私钥管理已从后端移至 CVM 实例
- 使用 @anemonelab/phala-cloud-sdk 进行 CVM 部署
- 新增CVM池管理，自动维护可用CVM
- 支持任意命名的Phala账户，无需特定命名格式
- 简化了账户状态流转，使用三种状态（ready、deployed、in_use）
- 服务启动时自动检查并维护CVM池 