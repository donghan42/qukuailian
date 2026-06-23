// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Crowdfunding 众筹智能合约（纯链上版）
 * @dev 所有业务数据（用户、项目、捐赠、流水）全部上链，无需传统数据库
 */
contract Crowdfunding {
    // ========== 数据结构 ==========

    // 项目状态
    enum ProjectStatus {
        Funding,    // 众筹中
        Successful, // 众筹成功
        Failed,     // 众筹失败
        Withdrawn   // 已提取 / 已退款
    }

    // 资金流水类型
    enum TxType {
        Donation,   // 捐赠
        Withdraw,   // 提取
        Refund      // 退款
    }

    // 用户信息
    struct User {
        string username;        // 用户名
        string email;           // 邮箱
        string phone;           // 手机号
        string realName;        // 真实姓名
        uint64 createdAt;       // 注册时间
        bool exists;            // 是否存在
    }

    // 项目
    struct Project {
        uint256 id;
        address payable creator;
        string title;
        string description;
        string category;
        string coverImage;
        uint256 goalAmount;     // wei
        uint256 currentAmount;  // wei
        uint256 deadline;       // 时间戳
        ProjectStatus status;
        bool exists;
    }

    // 捐赠记录
    struct Donation {
        address donor;
        uint256 projectId;
        uint256 amount;         // wei
        uint64 timestamp;
        string message;
        bool refunded;
    }

    // 资金流水
    struct FundRecord {
        uint256 projectId;
        address user;
        TxType txType;
        uint256 amount;         // wei
        uint64 timestamp;
    }

    // ========== 存储 ==========

    // 用户：address => User
    mapping(address => User) public users;
    // 用户名索引：username => address（避免重名）
    mapping(bytes32 => address) public usernameToAddress;

    // 项目：id => Project
    mapping(uint256 => Project) public projects;
    uint256 public projectCount;

    // 捐赠：projectId => 捐赠记录列表
    mapping(uint256 => Donation[]) public projectDonations;
    // 用户累计捐赠：donor => (projectId => 金额)
    mapping(address => mapping(uint256 => uint256)) public donatedAmount;
    // 用户捐赠过的项目列表
    mapping(address => uint256[]) public donorProjects;
    // 用户发起的项目
    mapping(address => uint256[]) public creatorProjects;

    // 流水：按用户索引
    mapping(address => FundRecord[]) public userFundRecords;
    // 全部流水
    FundRecord[] public allFundRecords;

    // ========== 事件 ==========

    event UserRegistered(address indexed user, string username, uint64 timestamp);
    event UserUpdated(address indexed user, uint64 timestamp);

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed creator,
        string title,
        uint256 goalAmount,
        uint256 deadline
    );

    event DonationMade(
        uint256 indexed projectId,
        address indexed donor,
        uint256 amount
    );

    event FundsWithdrawn(
        uint256 indexed projectId,
        address indexed creator,
        uint256 amount
    );

    event RefundIssued(
        uint256 indexed projectId,
        address indexed donor,
        uint256 amount
    );

    // ========== 用户管理 ==========

    /**
     * @dev 注册用户（用户名必须唯一）
     */
    function registerUser(
        string memory _username,
        string memory _email,
        string memory _phone,
        string memory _realName
    ) public {
        require(bytes(_username).length >= 3, "用户名至少3个字符");
        require(bytes(_username).length <= 20, "用户名最多20个字符");
        require(!users[msg.sender].exists, "该钱包已注册");

        bytes32 key = keccak256(abi.encodePacked(_username));
        require(usernameToAddress[key] == address(0), "用户名已被使用");

        users[msg.sender] = User({
            username: _username,
            email: _email,
            phone: _phone,
            realName: _realName,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        usernameToAddress[key] = msg.sender;

        emit UserRegistered(msg.sender, _username, uint64(block.timestamp));
    }

    /**
     * @dev 更新用户信息
     */
    function updateUser(
        string memory _email,
        string memory _phone,
        string memory _realName
    ) public {
        require(users[msg.sender].exists, "请先注册");
        User storage u = users[msg.sender];
        u.email = _email;
        u.phone = _phone;
        u.realName = _realName;
        emit UserUpdated(msg.sender, uint64(block.timestamp));
    }

    function getUser(address _user) public view returns (
        string memory username,
        string memory email,
        string memory phone,
        string memory realName,
        uint64 createdAt,
        bool exists
    ) {
        User memory u = users[_user];
        return (u.username, u.email, u.phone, u.realName, u.createdAt, u.exists);
    }

    function isRegistered(address _user) public view returns (bool) {
        return users[_user].exists;
    }

    // ========== 众筹项目 ==========

    function createProject(
        string memory _title,
        string memory _description,
        string memory _category,
        string memory _coverImage,
        uint256 _goalAmount,
        uint256 _durationSeconds
    ) public returns (uint256) {
        require(users[msg.sender].exists, "请先注册用户");
        require(bytes(_title).length > 0, "标题不能为空");
        require(_goalAmount > 0, "目标金额必须大于0");
        require(_durationSeconds > 0, "持续时间必须大于0");

        projectCount++;
        uint256 projectId = projectCount;
        uint256 deadline = block.timestamp + _durationSeconds;

        projects[projectId] = Project({
            id: projectId,
            creator: payable(msg.sender),
            title: _title,
            description: _description,
            category: _category,
            coverImage: _coverImage,
            goalAmount: _goalAmount,
            currentAmount: 0,
            deadline: deadline,
            status: ProjectStatus.Funding,
            exists: true
        });

        creatorProjects[msg.sender].push(projectId);

        emit ProjectCreated(projectId, msg.sender, _title, _goalAmount, deadline);
        return projectId;
    }

    function donate(uint256 _projectId, string memory _message) public payable {
        require(users[msg.sender].exists, "请先注册用户");
        Project storage project = projects[_projectId];
        require(project.exists, "项目不存在");
        require(project.status == ProjectStatus.Funding, "项目不在众筹中");
        require(block.timestamp < project.deadline, "众筹已结束");
        require(msg.value > 0, "捐赠金额必须大于0");

        project.currentAmount += msg.value;
        donatedAmount[msg.sender][_projectId] += msg.value;

        // 首次捐赠，记录
        if (donatedAmount[msg.sender][_projectId] == msg.value) {
            donorProjects[msg.sender].push(_projectId);
        }

        projectDonations[_projectId].push(Donation({
            donor: msg.sender,
            projectId: _projectId,
            amount: msg.value,
            timestamp: uint64(block.timestamp),
            message: _message,
            refunded: false
        }));

        // 写入资金流水
        FundRecord memory r = FundRecord({
            projectId: _projectId,
            user: msg.sender,
            txType: TxType.Donation,
            amount: msg.value,
            timestamp: uint64(block.timestamp)
        });
        userFundRecords[msg.sender].push(r);
        allFundRecords.push(r);

        // 达到目标
        if (project.currentAmount >= project.goalAmount) {
            project.status = ProjectStatus.Successful;
        }

        emit DonationMade(_projectId, msg.sender, msg.value);
    }

    function withdrawFunds(uint256 _projectId) public {
        Project storage project = projects[_projectId];
        require(project.exists, "项目不存在");
        require(project.creator == msg.sender, "只有项目发起人可以提取");
        require(project.status == ProjectStatus.Successful, "项目未达到目标");
        require(project.currentAmount > 0, "没有可提取的资金");

        uint256 amount = project.currentAmount;
        project.currentAmount = 0;
        project.status = ProjectStatus.Withdrawn;

        // 流水
        FundRecord memory r = FundRecord({
            projectId: _projectId,
            user: msg.sender,
            txType: TxType.Withdraw,
            amount: amount,
            timestamp: uint64(block.timestamp)
        });
        userFundRecords[msg.sender].push(r);
        allFundRecords.push(r);

        (bool success, ) = project.creator.call{value: amount}("");
        require(success, "转账失败");

        emit FundsWithdrawn(_projectId, msg.sender, amount);
    }

    function refund(uint256 _projectId) public {
        Project storage project = projects[_projectId];
        require(project.exists, "项目不存在");

        // 自动更新状态
        if (project.status == ProjectStatus.Funding && block.timestamp >= project.deadline) {
            if (project.currentAmount >= project.goalAmount) {
                project.status = ProjectStatus.Successful;
            } else {
                project.status = ProjectStatus.Failed;
            }
        }

        require(project.status == ProjectStatus.Failed, "项目未失败，不可退款");

        uint256 amount = donatedAmount[msg.sender][_projectId];
        require(amount > 0, "您没有向该项目捐赠");
        require(amount <= address(this).balance, "合约余额不足");

        donatedAmount[msg.sender][_projectId] = 0;

        // 标记该用户的捐赠记录为已退款
        Donation[] storage dons = projectDonations[_projectId];
        for (uint i = 0; i < dons.length; i++) {
            if (dons[i].donor == msg.sender && !dons[i].refunded) {
                dons[i].refunded = true;
            }
        }

        FundRecord memory r = FundRecord({
            projectId: _projectId,
            user: msg.sender,
            txType: TxType.Refund,
            amount: amount,
            timestamp: uint64(block.timestamp)
        });
        userFundRecords[msg.sender].push(r);
        allFundRecords.push(r);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "退款失败");

        emit RefundIssued(_projectId, msg.sender, amount);
    }

    // ========== 查询接口 ==========

    function getProject(uint256 _projectId) public view returns (
        uint256 id,
        address creator,
        string memory title,
        string memory description,
        string memory category,
        string memory coverImage,
        uint256 goalAmount,
        uint256 currentAmount,
        uint256 deadline,
        ProjectStatus status
    ) {
        Project memory p = projects[_projectId];
        require(p.exists, "项目不存在");
        return (p.id, p.creator, p.title, p.description, p.category, p.coverImage,
                p.goalAmount, p.currentAmount, p.deadline, p.status);
    }

    function getProjectDonations(uint256 _projectId) public view returns (Donation[] memory) {
        return projectDonations[_projectId];
    }

    function getDonationAmount(uint256 _projectId, address _donor) public view returns (uint256) {
        return donatedAmount[_donor][_projectId];
    }

    function getProjectsByCreator(address _creator) public view returns (uint256[] memory) {
        return creatorProjects[_creator];
    }

    function getProjectsByDonor(address _donor) public view returns (uint256[] memory) {
        return donorProjects[_donor];
    }

    function getUserFundRecords(address _user) public view returns (FundRecord[] memory) {
        return userFundRecords[_user];
    }

    function getAllFundRecordsLength() public view returns (uint256) {
        return allFundRecords.length;
    }

    function getFundRecord(uint256 _idx) public view returns (
        uint256 projectId,
        address user,
        TxType txType,
        uint256 amount,
        uint64 timestamp
    ) {
        FundRecord memory r = allFundRecords[_idx];
        return (r.projectId, r.user, r.txType, r.amount, r.timestamp);
    }

    function getAllFundRecords(uint256 _offset, uint256 _limit) public view returns (FundRecord[] memory) {
        uint256 total = allFundRecords.length;
        if (_offset >= total) return new FundRecord[](0);
        uint256 end = _offset + _limit;
        if (end > total) end = total;
        uint256 size = end - _offset;
        FundRecord[] memory result = new FundRecord[](size);
        for (uint i = 0; i < size; i++) {
            result[i] = allFundRecords[_offset + i];
        }
        return result;
    }

    function checkAndUpdateStatus(uint256 _projectId) public {
        Project storage project = projects[_projectId];
        require(project.exists, "项目不存在");
        if (project.status == ProjectStatus.Funding && block.timestamp >= project.deadline) {
            if (project.currentAmount >= project.goalAmount) {
                project.status = ProjectStatus.Successful;
            } else {
                project.status = ProjectStatus.Failed;
            }
        }
    }
}
