//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
pragma abicoder v2;

// import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract ChainLinkAggregator is Ownable {
    mapping(address => address) public oracles;
    mapping(address => mapping(address => address)) public directOracles;

    function addOracle(address _token, address _oracle) public onlyOwner {
        oracles[_token] = _oracle;
    }

    function addOracleBatch(address[] memory _token, address[] memory _oracle)
        public
        onlyOwner
    {
        for (uint256 i = 0; i < _token.length; i++) {
            oracles[_token[i]] = _oracle[i];
        }
    }

    function addDirectOracle(
        address _token1,
        address _token2,
        address _oracle
    ) public onlyOwner {
        directOracles[_token1][_token2] = _oracle;
    }

    function addDirectOracleBatch(
        address[] memory _token1,
        address[] memory _token2,
        address[] memory _oracle
    ) public onlyOwner {
        for (uint256 i = 0; i < _token1.length; i++) {
            directOracles[_token1[i]][_token2[i]] = _oracle[i];
        }
    }

    function getOracle(address _token) public view returns (address) {
        return oracles[_token];
    }

    function getDirectOracle(address _token1, address _token2)
        public
        view
        returns (address)
    {
        return directOracles[_token1][_token2];
    }

    function getPrice(address _token1, address _token2)
        external
        view
        returns (int256 price)
    {
        address oracle1 = directOracles[_token1][_token2];
        address oracle2 = directOracles[_token2][_token1];

        if (oracle1 != address(0)) {
            // If direct Oracle is Availabe
            return getOracleFeed(oracle1);
        } else if (oracle2 != address(0)) {
            // If reverse oracle is availabe
            return 10**36 / getOracleFeed(oracle2);
        }
        // If no direct oracel availabe check for Token/USD oracle for both Token1 and Token2
        oracle1 = oracles[_token1];
        oracle2 = oracles[_token2];
        if (oracle1 != address(0) && oracle2 != address(0)) {
            return (getOracleFeed(oracle1) * 10**18) / getOracleFeed(oracle2);
        }
        // If no oracle availabe return 0.
        return 0;
    }

    function getOracleFeed(address _oracle) public view returns (int256) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(_oracle);
        (, int256 price, , uint256 timeStamp, ) = aggregator.latestRoundData();
        // console.log("Current price", uint256(price));
        return scalePrice(price, aggregator.decimals(), 18);
    }

    function scalePrice(
        int256 _price,
        uint8 _priceDecimals,
        uint8 _decimals
    ) internal pure returns (int256) {
        if (_priceDecimals < _decimals) {
            return _price * int256(10**uint256(_decimals - _priceDecimals));
        } else if (_priceDecimals > _decimals) {
            return _price / int256(10**uint256(_priceDecimals - _decimals));
        }
        return _price;
    }
}
