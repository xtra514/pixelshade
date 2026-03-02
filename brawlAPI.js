const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.BRAWL_STARS_TOKEN;
const BASE_URL = 'https://api.brawlstars.com/v1';

/**
 * Creates an configured axios instance for the Brawl Stars API
 */
const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
    }
});

/**
 * Normalizes a club tag by removing the '#' or '%23' and converting to uppercase
 */
function normalizeTag(tag) {
    if (!tag) return '';
    return tag.replace(/^#/, '').replace(/^%23/i, '').toUpperCase();
}

/**
 * Fetches the members of a given club
 * @param {string} clubTag - The tag of the club (with or without #)
 * @returns {Promise<Array>} - Array of member objects
 */
async function getClubMembers(clubTag) {
    try {
        const tag = normalizeTag(clubTag);
        const response = await apiClient.get(`/clubs/%23${tag}/members`);
        return response.data.items;
    } catch (error) {
        console.error('Error fetching club members:', error.response?.data || error.message);
        throw new Error('Failed to fetch club members from Brawl Stars API. Check your tag and API key.');
    }
}

/**
 * Fetches an individual player's profile (updates faster than the club endpoint)
 * @param {string} playerTag - The tag of the player
 * @returns {Promise<Object>} - Player object
 */
async function getPlayer(playerTag) {
    try {
        const tag = normalizeTag(playerTag);
        const response = await apiClient.get(`/players/%23${tag}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching player ${playerTag}:`, error.response?.data || error.message);
        return null;
    }
}

module.exports = {
    getClubMembers,
    getPlayer
};
