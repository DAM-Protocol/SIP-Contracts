//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./Resolver.sol";

contract DCA {
    IUniswapV2Router02 public immutable Uniswap;

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

    event NewTask(address _from, address _to, uint256 _amount, uint64 _delay, uint64 _intervals);

    Task[] private tasks;
    uint256[] private deletedtasks;
    address[] private resolvers;

    constructor(address _swapRouter) {
        Uniswap = IUniswapV2Router02(_swapRouter);
    }

    function newTask(
        address _from,
        address _to,
        uint256 _amount,
        uint64 _delay,
        uint64 _intervals
    ) public returns (bool) {
        // Check for deleted Tasks;
        if (deletedtasks.length == 0) {
            // no deleted tasks, Insert new Task
            tasks.push(Task(msg.sender, _from, _to, _amount, 0, _delay, _intervals, 0));
            if (tasks.length % 1000 == 1) {
                resolvers.push(address(new Resolver(address(this), tasks.length - 1)));
            }
        } else {
            // there are deleted tasks, Replace a deleted task with new Task
            tasks[deletedtasks.length - 1] = Task(msg.sender, _from, _to, _amount, 0, _delay, _intervals, 0);
            deletedtasks.pop();
        }
        return true;
    }

    function getResolversCount() public view returns (uint256) {
        return resolvers.length;
    }

    function getResolver(uint256 _id) public view returns (address) {
        return resolvers[_id];
    }

    function getResolvers() public view returns (address[] memory) {
        return resolvers;
    }

    function deleteTask(uint256 _taskid) public {
        require(msg.sender == tasks[_taskid].owner, "Only the owner can delete a task");
        delete tasks[_taskid];
        deletedtasks.push(_taskid);
    }

    function checkTask(uint256 _taskid) public view returns (bool) {
        Task memory task = tasks[_taskid];
        return (task.intervals != 0 &&
            uint64(block.timestamp) - task.lastExecuted > task.delay &&
            task.count < task.intervals &&
            IERC20(task.from).balanceOf(task.owner) >= task.amount);
    }

    function checkTaskBatch(uint256 _index) external view returns (bool canExec, bytes memory execPayload) {
        canExec = false;
        for (uint256 i = _index; canExec == false && i < _index + 1000 && i < tasks.length; i++) {
            if (checkTask(i)) {
                execPayload = abi.encodeWithSelector(this.execTask.selector, i);
                canExec = true;
            }
        }
    }

    function execTask(uint256 _taskid) external {
        Task memory task = tasks[_taskid];
        require(checkTask(_taskid), "Chech failed");
        tasks[_taskid].count++;
        TransferHelper.safeTransferFrom(task.from, task.owner, address(this), task.amount);
        TransferHelper.safeApprove(task.from, address(Uniswap), task.amount);

        address[] memory path = new address[](2);
        path[0] = task.from;
        path[1] = task.to;

        Uniswap.swapExactTokensForTokens(task.amount, 0, path, task.owner, block.timestamp);

        if (task.count == task.intervals) {
            deleteTask(_taskid);
        }
    }
}
