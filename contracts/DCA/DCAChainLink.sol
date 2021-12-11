//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Interfaces/IChainLinkAggregator.sol";

contract DCAChainLink is Ownable {
    IUniswapV2Router02 private Uniswap;
    IChainLinkAggregator private ChainLinkAggregator;
    uint256 private slippage;
    bool private isactive;
    uint256 private fee;

    struct Task {
        address owner;
        address from;
        address to;
        uint256 amount;
        uint64 lastExecuted;
        uint64 delay;
        uint64 intervals;
        uint64 count;
    }

    event NewTask(
        uint256 id,
        address from,
        address to,
        uint256 amount,
        uint64 delay,
        uint64 intervals,
        address owner,
        uint64 lastExecuted,
        uint64 count
    );
    event DeleteTask(uint256 id);

    event TaskExecuted(uint256 id, uint64 count, uint64 lastExecuted);

    event Log(string message);

    Task[] private tasks;
    uint256[] private deletedtasks;

    constructor(
        address _swapRouter,
        address _chainLinkAggregator,
        uint256 _fee
    ) {
        Uniswap = IUniswapV2Router02(_swapRouter);
        ChainLinkAggregator = IChainLinkAggregator(_chainLinkAggregator);
        slippage = 3;
        isactive = true;
        fee = _fee;
    }

    function getRouter() public view returns (address) {
        return address(Uniswap);
    }

    function getAggregator() public view returns (address) {
        return address(ChainLinkAggregator);
    }

    function setRouter(address _swapRouter) public {
        Uniswap = IUniswapV2Router02(_swapRouter);
    }

    function setAggregator(address _chainLinkAggregator) public {
        ChainLinkAggregator = IChainLinkAggregator(_chainLinkAggregator);
    }

    function updateSlippage(uint256 _slippage) external onlyOwner {
        slippage = _slippage;
    }

    function updateFee(uint256 _fee) external onlyOwner {
        fee = _fee;
    }

    function deactivateContract() external onlyOwner {
        isactive = false;
    }

    function activateContract() external onlyOwner {
        isactive = true;
    }

    function collectFees(address payable _receiver) external onlyOwner {
        _receiver.transfer(payable(address(this)).balance);
    }

    function newTask(
        address _from,
        address _to,
        uint256 _amount,
        uint64 _delay,
        uint64 _intervals
    ) public payable returns (bool) {
        require(
            IERC20(_from).allowance(msg.sender, address(this)) >=
                _amount * _intervals,
            "newTask : No Allowance"
        );
        // take fees
        require(msg.value >= fee * _intervals, "newTask : No Fee");
        // Check for deleted Tasks;
        uint256 id;
        if (deletedtasks.length == 0) {
            // no deleted tasks, Insert new Task
            id = tasks.length;
            tasks.push(
                Task(msg.sender, _from, _to, _amount, 0, _delay, _intervals, 0)
            );
        } else {
            // there are deleted tasks, Replace a deleted task with new Task
            id = deletedtasks[deletedtasks.length - 1];
            tasks[id] = Task(
                msg.sender,
                _from,
                _to,
                _amount,
                0,
                _delay,
                _intervals,
                0
            );
            deletedtasks.pop();
        }
        emit NewTask(
            id,
            _from,
            _to,
            _amount,
            _delay,
            _intervals,
            msg.sender,
            0,
            0
        );
        return true;
    }

    function deleteTask(uint256 _taskid) public returns (bool) {
        require(
            msg.sender == tasks[_taskid].owner,
            "Only the owner can delete a task"
        );
        delete tasks[_taskid];
        deletedtasks.push(_taskid);
        emit DeleteTask(_taskid);
        return true;
    }

    function checkTask(uint256 _taskid) public view returns (bool) {
        Task memory task = tasks[_taskid];
        return (task.intervals != 0 &&
            uint64(block.timestamp) - task.lastExecuted > task.delay &&
            task.count < task.intervals &&
            IERC20(task.from).balanceOf(task.owner) >= task.amount &&
            IERC20(task.from).allowance(task.owner, address(this)) >=
            task.amount);
    }

    function checkUpkeep(bytes calldata checkData)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        if (!isactive) return (false, bytes(""));
        uint256 index = abi.decode(checkData, (uint256)) * 100;
        upkeepNeeded = false;
        for (
            uint256 i = index;
            upkeepNeeded == false && i < index + 1000 && i < tasks.length;
            i++
        ) {
            if (checkTask(i)) {
                return (true, abi.encode(i));
            }
        }
    }

    function performUpkeep(bytes calldata performData) external {
        uint256 taskid = abi.decode(performData, (uint256));
        Task memory task = tasks[taskid];
        require(
            isactive &&
                task.intervals != 0 &&
                uint64(block.timestamp) - task.lastExecuted > task.delay &&
                task.count < task.intervals &&
                IERC20(task.from).balanceOf(task.owner) >= task.amount,
            "PUK : Chech failed"
        );

        tasks[taskid].count++;
        IERC20(task.from).transferFrom(task.owner, address(this), task.amount);
        if (
            IERC20(task.from).allowance(address(this), address(Uniswap)) <
            task.amount
        ) IERC20(task.from).approve(address(Uniswap), type(uint256).max);

        address[] memory path = new address[](2);
        path[0] = task.from;
        path[1] = task.to;

        uint256 minOut = (uint256(
            ChainLinkAggregator.getPrice(task.from, task.to)
        ) *
            task.amount *
            (100 - slippage)) / 10**20;

        // console.log("minOut", minOut);

        try
            Uniswap.swapExactTokensForTokens(
                task.amount,
                minOut,
                path,
                task.owner,
                block.timestamp
            )
        {
            //nothing to do here
        } catch Error(string memory error) {
            emit Log(error);
        }

        if (task.count == task.intervals) {
            deleteTask(taskid);
        }
        emit TaskExecuted(taskid, task.count + 1, uint64(block.timestamp));
    }
}
