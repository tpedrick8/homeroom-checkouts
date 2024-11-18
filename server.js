require('dotenv').config();
const express = require('express');
const axios = require('axios');
const homerooms = require('./homerooms'); // Import homerooms data

const app = express();
const PORT = 3000;

const destinyApiUrl = "https://lmc.isb.cn/api/v1/rest/context/destiny";
let accessToken = process.env.ACCESS_TOKEN;
let tokenExpiration = null;

async function fetchAccessToken() {
    try {
        console.log("Fetching new access token...");
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.CLIENT_ID);
        params.append('client_secret', process.env.CLIENT_SECRET);

        const response = await axios.post(`${destinyApiUrl}/auth/accessToken`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        accessToken = response.data.access_token;
        tokenExpiration = Date.now() + (response.data.expires_in * 1000);
        console.log("New access token retrieved successfully:", accessToken);
    } catch (error) {
        console.error("Error fetching access token:", error.message);
        throw new Error("Failed to fetch access token");
    }
}

async function ensureAccessToken(req, res, next) {
    if (!accessToken || Date.now() >= tokenExpiration) {
        await fetchAccessToken();
    }
    next();
}

// Log the homerooms data to check if it's loaded correctly
console.log("Homerooms data:", homerooms);

// Endpoint to retrieve predefined homerooms
app.get('/api/homerooms', (req, res) => {
    console.log("Fetching homerooms...");
    res.json(Object.keys(homerooms)); // Send homeroom names to the client
});

// Endpoint to retrieve students and their checkout counts for a selected homeroom
app.get('/api/homerooms/:homeroom/students', ensureAccessToken, async (req, res) => {
    const homeroom = req.params.homeroom;
    const districtIds = homerooms[homeroom];

    if (!districtIds) {
        console.log(`Error: Homeroom "${homeroom}" not found in homerooms list`);
        return res.status(404).json({ error: "Homeroom not found" });
    }

    console.log(`Fetching data for Homeroom: ${homeroom}, District IDs: ${JSON.stringify(districtIds)}`);

    try {
        const students = await Promise.all(districtIds.map(async (districtId) => {
            console.log(`Requesting data for student with District ID: ${districtId}`);

            try {
                const response = await axios.get(`${destinyApiUrl}/circulation/patrons/${districtId}/status`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });

                console.log(`Data received for student ID ${districtId}:`, response.data);

                const patron = response.data;
                const booksCheckedOut = patron.itemsOut ? patron.itemsOut.length : 0;

                // Calculate overdue items
                const today = new Date();
                const overdueBooks = patron.itemsOut ? patron.itemsOut.filter(item => new Date(item.dateDue) < today).length : 0;

                // Calculate final book allowance
                const startingBooks = homeroom.startsWith("3") || homeroom.startsWith("4") || homeroom.startsWith("5") ? 5 : 3;
                let finalAllowance = startingBooks - booksCheckedOut;

                if (finalAllowance < 1 || overdueBooks > 0) {
                    finalAllowance = 1;
                }

                return {
                    name: `${patron.firstName || 'Unknown'} ${patron.lastName || ''}`.trim(),
                    nickname: patron.nickName || 'No Nickname', // Include nickname
                    booksCheckedOut,
                    overdueBooks,
                    finalAllowance, // Add final allowance to response
                };
            } catch (innerError) {
                console.error(`Error fetching data for student ID ${districtId}: ${innerError.message}`);
                if (innerError.response) {
                    console.error("Status Code:", innerError.response.status);
                    console.error("Response Data:", innerError.response.data);
                }
                // Return default data for the student in case of an error
                return { name: "Unknown", nickname: "No Nickname", booksCheckedOut: 0, overdueBooks: 0, finalAllowance: 1, error: innerError.message };
            }
        }));

        console.log("Students data:", students);  // Log the fetched students data
        res.json(students);
    } catch (error) {
        console.error(`Error fetching student data for homeroom ${homeroom}:`, error.message);
        if (error.response) {
            console.error("Status Code:", error.response.status);
            console.error("Response Data:", error.response.data);
        }
        res.status(error.response ? error.response.status : 500).json({
            error: error.message,
            details: error.response ? error.response.data : "No additional details",
        });
    }
});

// Serve frontend files
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
