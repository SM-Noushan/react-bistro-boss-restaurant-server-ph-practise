const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    const paymentCollection = bbr.collection("paymentCollection");

    // middleware
    // verify token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization)
        return res.status(401).send({ message: "Unauthorized Access" });
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.Access_Token_Secret, (err, decoded) => {
        if (err)
          return res.status(401).send({ message: "Unauthorized Access" });
        req.decoded = decoded;
        next();
      });
    };

    // verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const uid = req.decoded.uid;
      let isAdmin = false;
      const query = { uid: uid };
      const result = await userCollection.findOne(query);
      if (result?.role === "admin") isAdmin = true;
      if (!isAdmin)
        return res.status(403).send({ message: "Forbidden Access" });
      next();
    };

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.Access_Token_Secret, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    //users api
    //verify admin
    app.get("/admin/verify/:uid", verifyToken, async (req, res) => {
      const uid = req.params.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      let role = false;
      const query = { uid: uid };
      const options = { projection: { _id: 0, role: 1 } };
      const result = await userCollection.findOne(query, options);
      if (result?.role === "admin") role = true;
      res.send({ role });
    });

    //get all user
    app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //store user data
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await userCollection.updateOne(
        { uid: user.uid }, //filter by uid
        { $setOnInsert: user }, //only store user if storing new user
        { upsert: true } //insert if document does not exist
      );
      res.send(result);
    });

    // update user role
    app.patch("/admin/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // remove user
    app.delete("/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // menu apis
    // get all data
    app.get("/menu", async (req, res) => {
      const category = req?.query?.category;
      let query = {};
      if (category) query = { category: { $regex: category, $options: "i" } };
      //   console.log(query);
      const cursor = menuCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get one menu item
    app.get("/menu/:id", async (req, res) => {
      const id = req?.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    // store menu item
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await menuCollection.insertOne(data);
      res.send(result);
    });

    // update menu item
    app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;
      const updateQuery = {
        $set: updatedData,
      };
      const result = await menuCollection.updateOne(filter, updateQuery);
      res.send(result);
    });

    // delete menu item
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
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
              userID: 0,
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
    app.delete("/cart/:id", verifyToken, async (req, res) => {
      if (req.query.uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      // console.log(amount);
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // payment related api
    // get payment details
    app.get("/payments", verifyToken, async (req, res) => {
      const uid = req?.query?.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const query = { uid };
      const options = {
        sort: { _id: -1 },
      };
      const result = await paymentCollection.find(query, options).toArray();
      res.send(result);
    });

    // store payment details
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      // delete cart items
      const query = {
        _id: { $in: payment.cartIds.map((cartId) => new ObjectId(cartId)) },
      };
      await cartCollection.deleteMany(query);
      const paymentResult = await paymentCollection.insertOne(payment);
      res.send(paymentResult);
    });

    // stats-analytics related api
    // get stats: users, menu-items, orders and revenue
    app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      const customers = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const getRevenue = await paymentCollection
        .aggregate([
          {
            $addFields: {
              parsePrice: { $toDouble: "$price" },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$parsePrice" },
            },
          },
        ])
        .toArray();
      const revenue = getRevenue.length > 0 ? getRevenue[0].totalRevenue : 0;
      res.send({ revenue, customers, products, orders });
    });
    // get order stats
    app.get(
      "/admin/order-stats",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await paymentCollection
          .aggregate([
            {
              $addFields: {
                menuItemIds_menuQuantity: {
                  $zip: { inputs: ["$menuItemIds", "$menuQuantity"] },
                },
              },
            },
            { $unwind: "$menuItemIds_menuQuantity" },
            {
              $addFields: {
                menuItemId: { $arrayElemAt: ["$menuItemIds_menuQuantity", 0] },
                quantity: { $arrayElemAt: ["$menuItemIds_menuQuantity", 1] },
                menuItemObjId: { $toObjectId: "$menuItemId" },
              },
            },
            {
              $addFields: {
                menuItemObjId: { $toObjectId: "$menuItemId" },
              },
            },
            {
              $lookup: {
                from: "menuCollection",
                localField: "menuItemObjId",
                foreignField: "_id",
                as: "menuDetails",
              },
            },
            { $unwind: "$menuDetails" },
            {
              $group: {
                _id: "$menuDetails.category",
                quantity: { $sum: "$quantity" },
                price: {
                  $sum: { $multiply: ["$quantity", "$menuDetails.price"] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                category: "$_id",
                quantity: 1,
                revenue: "$price",
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );
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
