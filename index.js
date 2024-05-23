const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// cookie
const cookieOption = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  secure: process.env.NODE_ENV === "production" ? true : false,
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6wqjn1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    console.log("Successfully connected to MongoDB!");

    // Connect to the "bistroBossRestaurant" database
    const bbr = client.db("bistroBossRestaurant");
    const userCollection = bbr.collection("userCollection");
    const menuCollection = bbr.collection("menuCollection");
    const cartCollection = bbr.collection("cartCollection");

    //users api
    //store user data
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // menu apis
    // get all data
    app.get("/menu", async (req, res) => {
      const category = req.query.category;
      const query = { category: { $regex: category, $options: "i" } };
      //   console.log(query);
      const cursor = menuCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // cart apis
    //get cart items
    app.get("/carts", async (req, res) => {
      const userID = req?.query?.userId;
      const myCartItems = await cartCollection
        .aggregate([
          { $match: { userID } },
          {
            $lookup: {
              from: "menuCollection",
              let: { menuIdObj: { $toObjectId: "$menuID" } },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$_id", "$$menuIdObj"] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    image: 1,
                    price: 1,
                  },
                },
              ],
              as: "details",
            },
          },
          {
            $unwind: "$details",
          },
          {
            $project: {
              _id: 1,
              quantity: 1,
              details: 1,
            },
          },
        ])
        .toArray();
      res.send(myCartItems);
    });

    //get total number of cart items
    app.get("/carts/total", async (req, res) => {
      const filter = { userID: req?.query?.userUID };
      //   if (!req?.query?.userUID) {
      //     res.send({ message: "No User ID" });
      //   } else {
      const count = await cartCollection.countDocuments(filter);
      res.send({ count });
      //   }
    });

    // save or update cart data
    app.post("/carts", async (req, res) => {
      const query = req.body;
      const update = { $inc: { quantity: 1 } };
      const options = { upsert: true };
      const result = await cartCollection.updateOne(query, update, options);
      res.send(result);
    });

    // remove cart item
    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
    // console.log(
    //   "Close your deployment. You successfully terminate connection to MongoDB!"
    // );
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("BistroBoss Server RUNNING");
});

app.listen(port, () => {
  console.log(`spying on port ${port}`);
});
