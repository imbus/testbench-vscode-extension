import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'https';
import * as process from "process";

// Ignore SSL certificate validation in node requests to disable certificate validation, otherwise the connection will always fail
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Connection to save a session
export class Connection {
    serverUrl: string;
    loginName: string;
    password: string;
    session: AxiosInstance;

    constructor(serverUrl: string, loginName: string, password: string) {
        this.serverUrl = serverUrl;
        this.loginName = loginName;
        this.password = password;
        this.session = axios.create({
            baseURL: serverUrl,
            auth: {
                username: loginName,
                password: password
            },
            headers: {
                'Content-Type': 'application/vnd.testbench+json; charset=utf-8'
            },
            // Ignore self-signed certificates
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });
    }

    // Sends a GET request to the projects endpoint to verify if the connection is working (Status 200).
    async checkIsWorking(): Promise<boolean> {
        try {
            console.log(`Checking connection to ${this.serverUrl}`);
            const response: AxiosResponse = await this.session.get("projects", {
                params: {
                    includeTOVs: "false",
                    includeCycles: "false",
                },
            });
            console.log(`Response status: ${response.status}`);
            return response.status === 200;
        } catch (error: any) {
            console.error("Error checking connection:", error.message);
            console.error("Error config:", error.config);
            if (error.response) {
                console.error("Error response data:", error.response.data);
                console.error("Error response status:", error.response.status);
                console.error("Error response headers:", error.response.headers);
            }
            return false;
        }
    }

    async getAllProjects(): Promise<any[]> {
        try {
            const response = await this.session.get('projects', {
                params: { includeTOVs: 'true', includeCycles: 'true' }
            });
            console.log('Response from getAllProjects:', response.data);

            return response.data.projects || [];
        } catch (error) {
            console.error('Error getting all projects:', error);
            return [];
        }
    }

    async getTovStructure(tovKey: string): Promise<any> {
        try {
            const response = await this.session.get(`tovs/${tovKey}/structure`);
            return response.data;
        } catch (error) {
            console.error('Error getting TOV structure:', error);
            return [];
        }
    }

    async getTestCycleStructure(cycleKey: string): Promise<any> {
        try {
            const response = await this.session.get(`cycle/${cycleKey}/structure`);
            return response.data;
        } catch (error) {
            console.error('Error getting test cycle structure:', error);
            return [];
        }
    }

    async getTestCases(testCaseSetKey: string, specificationKey: string): Promise<any> {
        try {
            const response = await this.session.get(
                `testCaseSets/${testCaseSetKey}/specifications/${specificationKey}/testCases`
            );
            return response.data;
        } catch (error) {
            console.error('Error getting test cases:', error);
            return [];
        }
    }
}

export async function login(server: string, loginName: string, password: string): Promise<Connection | null> {
    const connection = new Connection(server, loginName, password);
    if (await connection.checkIsWorking()) {
        return connection;
    }
    return null;
}
